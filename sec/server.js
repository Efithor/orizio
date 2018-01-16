//server.js

//set up
//Get what we need
var express   = require('express');
var app       = express();
var port      = process.env.PORT || 8080;
var mongoose  = require('mongoose');
var User      = require('./app/models/user');
var passport  = require('passport');
var flash     = require('connect-flash');

var morgan       = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser   = require('body-parser');
var session      = require('express-session');

var jwt = require('jsonwebtoken');
var secretFile = require('./config/secret.js');
//Connect to database
var configDB = require('./config/database.js');
//Load gamedata
var challenges = require('./app/gamedata/challenges.json');
var itemClasses = require('./app/gamedata/itemClasses.json');
var items = require('./app/gamedata/items.json');
var places = require('./app/gamedata/places.json');
var ratings = require('./app/gamedata/ratings.json');
var skills = require('./app/gamedata/skills.json');

var dataCheck = require('./app/datachecks.js');

var orizioConfig = require('./config/orizioConfig.json')
var server = require('http').Server(app);
var io = require('socket.io')(server);

// configuration
mongoose.connect(configDB.url, { useMongoClient: true }); //Connect to our database.
//mongoose.Promise = global.Promise;

require('./config/passport')(passport); // pass passport for configuration

// setup express application
app.use(morgan('dev'));
app.use(cookieParser());
app.use(bodyParser());

app.set('view engine', 'ejs');

// for passport

app.use(session({ secret: secretFile.theSecret}));
app.use(passport.initialize());
app.use(passport.session());
app.use(flash());
app.use(express.static('public'));

//routes
require('./app/routes.js')(app, passport); // load our routes and pass in our app and fully configured passport

//Ensure Gamedata is valid.
dataCheck.checkData(challenges,itemClasses,items,places,ratings,skills);

//Socket section
io.use(function(socket, next){
  //Verify Token
  if (socket.handshake.query && socket.handshake.query.token){
    jwt.verify(socket.handshake.query.token, secretFile.theSecret, function(err, decoded) {
      console.log('Verifying Token');
      if(err) return next(new Error('Authentication error'));
      socket.decoded = decoded;
      next();
    });
  }
  next(new Error('Authentication error'));
})
.on('connection', function(socket) {
    // Find the user stated in the token.
    User.findById(socket.decoded, function(err, user){
      if (err)
        console.log(err);

      //If user is banned, block user.
      if(user.local.accountBanned){
        console.log('User ' + user.local.email + ' is banned. Disconnecting...');
        socket.disconnect();
        return;
      }

      //If user already has a socket connection, close the connection
      for(var i=0; i< Object.keys(io.sockets.connected).length; i++){
        if(typeof io.sockets.connected[Object.keys(io.sockets.connected)[i]].userInfo != 'undefined' && user.local.email === io.sockets.connected[Object.keys(io.sockets.connected)[i]].userInfo.email){
          console.log('User ' + user.local.email + ' is already connected. Disconnecting...');
          socket.disconnect();
          return;
        }
      }

      //ascribe user to socket space for easier access.
      socket.userInfo = user.local;
      //Have the user join their own personal channel.
      socket.join('priv/' + user.id);

      //If the user's character has not been created, have them do so.
      if(!user.local.characterCreated){
        io.to('priv/' + user.id).emit('chat message', 'Welcome, ' + user.local.email);
        io.to('priv/' + user.id).emit('chat message', 'Please name yourself.');
      }else{
        manifestPlayerCharacter(user,socket);
      }


      // ============================================
      // SERVER SIDE VERB LIST ======================
      // ============================================
      // Might want to move this into its own file at some point in the future.

      // VERB: CHAT
      socket.on('chat message', function(msg){
        //Determine if verb is valid
        //If the user does not have a created character, the first chat message they enter is their name.
        if(!user.local.characterCreated){
          changeCharName(user,msg,socket);
          setupCharacterSkills(user);
          manifestPlayerCharacter(user,socket);
          user.local.characterCreated = true;
          return;
        }
        console.log('['+ user.local.characterLocationID+'] ' + user.local.characterName + ': ' + msg);
        io.to('room/'+user.local.characterLocationID).emit('chat message', user.local.characterName + ': ' + msg);
      })
      //VERB: MOVE
      // Move the character
      socket.on('char move', function(destinationID){
        // Check if move is valid.
        // If the player is adventuring, they can't move.
        if(user.local.isAdventuring){
          return console.log(user.local.characterName + " is unable to move: adventuring.");
        }
        // Find the room the user is in.
        var currRoom = getUserRoomRef(user.local.characterLocationID);
        //Ensure that said room has that exit.
        var exitIsValid = false;
        for(var i=0;i<currRoom.exits.length;i++){
          if(currRoom.exits[i]===destinationID){
            exitIsValid = true;
            break;
          }
        }
        if(!exitIsValid){
          return console.log('Exit ' + destinationID + ' is invalid.');
        }
        // If so, update the character's position in the database and send them a message.
        user.local.characterLocationID = destinationID;
        user.save(function(err) {
            if (err)
                throw err;
            return null;
        });
        socket.leave('room/'+currRoom.id);
        emitUsersInRoomList(currRoom.id);
        io.to('room/'+currRoom.id).emit('chat message',user.local.characterName + ' exits the ' + currRoom.displayName);
        currRoom = getUserRoomRef(user.local.characterLocationID);
        if(currRoom.type==="plaza"){
          io.to('room/'+user.local.characterLocationID).emit('chat message',user.local.characterName + ' walks into the ' + currRoom.displayName);
          socket.join('room/'+user.local.characterLocationID);
          emitUsersInRoomList(user.local.characterLocationID);
          console.log(user.local.email + ' has moved to ' + destinationID);
          io.to('priv/' + user.id).emit('data: validExits', currRoom.exits);
          io.to('priv/' + user.id).emit('data: currRoom', currRoom.id);
          io.to('priv/' + user.id).emit('chat message', 'You move to the ' + currRoom.displayName);
          io.to('priv/' + user.id).emit('chat message', currRoom.description);
        }
        if(currRoom.type==="dungeon"){
          adventure(user, currRoom.id);
        }
      })
      //VERB: DISCONNECT
      socket.on('disconnect', function(){
        //Record time of disconnect in server time.
        user.timeLastLoggedOut = new Date();
        //Update localFolksList for the left room
        io.to('room/'+user.local.characterLocationID).emit('chat message',user.local.characterName + ' vanishes from the ' + getUserRoomRef(user.local.characterLocationID).displayName);
        emitUsersInRoomList(user.local.characterLocationID);
      })

      //VERB: GET INVENTORY
      socket.on('getInventory', function(){
        io.to('priv/' + user.id).emit('data: inventory', user.local.inventory);
      })

      //VERB: GET HEALTH
      socket.on('getInventory', function(){
        io.to('priv/' + user.id).emit('data: health', user.local.health);
      })

      //VERB: REMOVE ITEM FROM INVENTORY
      socket.on('discardItem', function(itemGUID){
        //Ensure user is not adventuring.
        if(user.local.isAdventuring){
          return console.log(user.local.characterName + " is unable to discard item: adventuring.");
        }
        removeItemFromInventory(user, itemGUID);
        io.to('priv/' + user.id).emit('data: inventory', user.local.characterInventory);
      })

      //VERB: EQUIP ITEM
      //Move an item from inventory to equipped.
      socket.on('equipItem', function(itemGUID){
        //Ensure user is not adventuring.
        if(user.local.isAdventuring){
          return console.log(user.local.characterName + " is unable to equip: adventuring.");
        }
        moveItemFromInventoryToEquipment(user, itemGUID);
        io.to('priv/' + user.id).emit('data: inventory', user.local.characterInventory);
        io.to('priv/' + user.id).emit('data: equipment', user.local.characterEquipment);
      })

      //VERB: UNQUIP ITEM
      //Move an item from equipped to inventory.
      socket.on('unequipItem', function(itemGUID){
        //Ensure user is not adventuring.
        if(user.local.isAdventuring){
          return console.log(user.local.characterName + " is unable to unequip: adventuring.");
        }
        moveItemFromEquipmentToInventory(user, itemGUID);
        io.to('priv/' + user.id).emit('data: inventory', user.local.characterInventory);
        io.to('priv/' + user.id).emit('data: equipment', user.local.characterEquipment);
      })

      //VERB: GET EQUIPMENT
      // Pass an object to the client listing their equipment.
      socket.on('getEquipment', function(){
        io.to('priv/' + user.id).emit('data: equipment', user.local.characterEquipment);
      })
      //VERB: GET SKILLS
      // Pass an object to the client listing their skills.
      socket.on('getSkills', function(){
        io.to('priv/' + user.id).emit('data: skills', user.local.skills);
      })
      //VERB: GET RATINGS
      // Pass an object to the client listing their ratings.
      socket.on('getRatings', function(){
        io.to('priv/' + user.id).emit('data: ratings', tabulateRatings(user));
      })

      return user;
    });
});

// launch
server.listen(3000, function(){
  console.log('chat listening on :3000');
});

app.listen(port);
console.log('Auth listening on ' + port);

//****************************************
//******** CONSTANT ACTIONS **************
//****************************************

//Every minute, give each logged in user 1 HP.
var healEveryPlayerEveryMin = setInterval(giveHealthToAllLoggedInPlayers,60000);


//****************************************
//*********FUNCTIONS**********************
//****************************************

//*********INVENTORY FUNCTIONS************
//Given a user and an item, create an instance of it in the player's inventory.
//Item structure: {
//                 item.GUID: GUID,
//                 item.typeID: (e.g. "wrathiteHammer"),
//                }
function addItem(_user,_itemID){
  var user = _user;
  var itemID = _itemID;
  var item;

  item.itemGUID = createGUID();
  item.typeID = itemID;

  user.local.characterInventory.push(item);
}

//doesUserHaveItem()
//Given a user and an itemGUID, determine if they have that item in inventory.
function doesUserHaveItem(user,itemGUID){
  for(var i=0;i<user.local.characterInventory.length;i++){
    if(user.local.characterInventory[i].id===itemGUID){
      return true;
    }
  }
  return false;
}

//doesUserHaveItemEquipped()
//Given a user and an itemGUID, determine if they have that item equipped.
function doesUserHaveItemEquipped(user,itemGUID){
  for(var i=0;i<user.local.characterEquipment.length;i++){
    if(user.local.characterEquipment[i].id===itemGUID){
      return true;
    }
  }
  return false;
}

//removeItemFromInventory()
//Remove an item from a user's inventory.
function removeItemFromInventory(user, itemToRemoveGUID){
  if(!doesUserHaveItem(user,itemToRemoveGUID)){
    return console.log(user.local.username + ' cannot discard ' + itemToRemoveGUID + '. Item not found.');
  }
  user.local.characterInventory.filter(function(el) {
    return el.itemGUID === itemToRemoveGUID;
  });
  return console.log("Item " + itemToRemoveGUID + " removed from user " + user.local.email);
}

//removeItemFromEquipment()
//Remove an item from a user's equipment.
function removeItemFromEquipment(user, itemToRemoveGUID){
  if(!doesUserHaveItemEquipped(user,itemToRemoveGUID)){
    return console.log(user.local.username + ' cannot remove ' + itemToRemoveGUID + '. Item not found.');
  }
  user.local.characterEquipment.filter(function(el) {
    return el.itemGUID === itemToRemoveGUID;
  });
  return console.log("Item " + itemToRemoveGUID + " removed from user " + user.local.email);
}

//getEquipmentPower()
//Given an item id, return its power. If invalid item, return false;
function getEquipmentPower(itemId){
  for(var i=0;i<items.length;i++){
    if(items[i].id===itemID && itemHasType(itemID,"equipment")){
      return items[i].power;
    }
  }
  return false;
}

//getClassofEquipment()
//Given an item ID, return its class if it's equpment.
function getClassofEquipment(itemID){
  for(var i=0;i<items.length;i++){
    if(items[i].id===itemID && itemHasType(itemID,"equipment")){
      return items[i].class;
    }
  }
  return false;
}

//itemHasType()
//Given an item and a type, return true if it has that type.
function itemHasType(itemID, type){
  for(var i=0;i<items.length;i++){
    if(items[i].id===itemID){
      for(var q=0;q<items[i].types.length;q++){
        if(items[i].types[q]===type){
          return true;
        }
      }
    }
  }
  return false;
}

//moveItemFromInventoryToEquipment()
//Move an item from a user's inventory to their equipment.
//Takes an item GUID and a user.
function moveItemFromInventoryToEquipment(user, itemToMoveGUID){
  //Ensure the user actually has the item.
  if(!doesUserHaveItem(user,itemToMoveGUID)){
    return console.log("Unable to equip item " + itemToMoveGUID + ". User does not have item.");
  }
  //Find the item and see if it can be equipped.
  for(var i=0;i<user.local.characterInventory.length;i++){
    if(user.local.characterInventory[i].itemGUID===itemToMoveGUID){
      if(!itemHasType(user.local.characterInventory[i],"equipment")){
        return console.log("Unable to equip item " + itemToMoveGUID + "Item not equipment.");
      }
      //If so, equip it.
      var item;
      item.itemGUID = user.local.characterInventory[i].itemGUID;
      item.typeID = user.local.characterInventory[i].typeID;
      user.local.characterEquipment.push(item);
      //Remove the item from inventory.
      removeItemFromInventory(user,item.itemGUID);
      return console.log("User " + user.characterName + " has equipped " + item.typeID);
    }
  }
}

//moveItemFromEquipmentToInventory()
//Move an item from a user's equipment to their inventory.
//Takes an item GUID and a user.
function moveItemFromEquipmentToInventory(user, itemToMoveGUID){
  //Ensure the user actually has the item.
  if(!doesUserHaveItemEquipped(user,itemToMoveGUID)){
    return console.log("Unable to unequip item " + itemToMoveGUID + ". User does not have item equipped.");
  }
  //Find the item and see if it can be equipped.
  for(var i=0;i<user.local.characterEquipment.length;i++){
    if(user.local.characterEquipment[i].itemGUID===itemToMoveGUID){
      //Unequip it.
      var item;
      item.itemGUID = user.local.characterInventory[i].itemGUID;
      item.typeID = user.local.characterInventory[i].typeID;
      user.local.characterInventory.push(item);
      //Remove the item from inventory.
      removeItemFromEquipment(user,item.itemGUID);
      return console.log("User " + user.characterName + " has unequipped " + item.typeID);
    }
  }
}


//*********LOCATION FUNCTIONS*************
//getUserRoomRef()
//Given a user, return a ref to the room they're in.
function getUserRoomRef(user){
  for(var i=0;i<places.length;i++){
    if(user===places[i].id){
      return places[i];
    }
  }
}

//validLocationID()
//Check if a location is on a valid location.
function validLocationID(locID){
  for(var i=0;i<places.length;i++){
    if(places[i].id===locID){
      return true;
    }
  }
  return false;
}

//emitUsersInRoomList()
//Given the id of a room, emit the current player list for that room to users in said room.
//Should be used just after someone enters or leaves a room.
function emitUsersInRoomList(_roomToUpdate){
  var roomToUpdate = _roomToUpdate;
  var playerList = [];
  //If there's nobody in the room, do nothing.
  if (typeof io.sockets.adapter.rooms['room/'+roomToUpdate] === "undefined") {
    return;
  }
  for(var i=0;i<io.sockets.adapter.rooms['room/'+roomToUpdate].length;i++){
    playerList[i] = io.sockets.connected[Object.keys(io.sockets.adapter.rooms['room/'+roomToUpdate].sockets)[i]].userInfo.characterName;
  }
  //Sort array alphabetically to improve readablity and prevent players from using it to suss out other player's tokens.
  playerList.sort();
  io.to('room/'+roomToUpdate).emit('data: playerList', playerList);
}


//*********CHARACTER FUNCTIONS************
//changeCharName()
//Given a user, change their name.
function changeCharName(user, newName,socket){
  var socket = socket;
  User.findOne({ 'local.characterName' : newName}, function(err, otherUser) {
    //If there's an error, return it.
    if (err)
      return err;

    if(otherUser) {
      return io.to('priv/' + user.id).emit('chat message', 'The name ' + newName + ' has already been taken.');
    } else{
      //Change the character's name
      user.local.characterName = newName;
      user.save(function(err) {
          if (err)
              throw err;
          return null;
      });
      console.log('[NAMING]' + user.local.email + ' has named themselves ' + user.local.characterName);
      io.to('priv/' + user.id).emit('chat message', 'You have named yourself ' + user.local.characterName);
      return;
    }
  });
}

//manifestPlayerCharacter()
// Manifest a player character into the gameworld.
function manifestPlayerCharacter(_user,_socket){
  user = _user;
  socket = _socket;
  //Do normal sign in stuff.
  //If the user's location is either null or DNA, set the user's location to the starting area.
  if(!validLocationID(user.local.characterLocationID)){
    console.log(user.local.email + ' has an invalid position. Sending to ' + places[0].displayName);
    user.local.characterLocationID = places[0].id; //Replace this with the room entry function.
    user.save(function(err) {
        if (err)
            throw err;
        return null;
    });
  };
  //Give the user HP, dependant on the time they have been logged out.
  giveHealthGainedWhileLoggedOut(user);
  //Have the user join the channel for the room they're standing in.
  io.to('room/'+user.local.characterLocationID).emit('chat message',user.local.characterName + ' manifests into the ' + getUserRoomRef(user.local.characterLocationID).displayName);
  socket.join('room/'+user.local.characterLocationID);
  emitUsersInRoomList(user.local.characterLocationID);
  //All is good, the user has connected!

  //Update localFolksList for the joined room
  io.to('priv/' + user.id).emit('data: validExits', getUserRoomRef(user.local.characterLocationID).exits);
  io.to('priv/' + user.id).emit('data: currRoom', getUserRoomRef(user.local.characterLocationID).id);
  io.to('priv/' + user.id).emit('chat message', 'Welcome, ' + user.local.characterName);
  io.to('priv/' + user.id).emit('chat message', getUserRoomRef(user.local.characterLocationID).description);
}

//setupStats
//Setup any stats the player character might have.
//Right now it's just health.
function setupStats(user){
  if(typeof user.health === "undefined" || user.health < 0){
    user.health = 100;
    user.save(function(err) {
        if (err)
            throw err;
        return null;
    });
  }
}

//setupCharacterSkills()
//Given a user, if they're missing any skills, set those to 1.
function setupCharacterSkills(_user){
  var user = _user;
  var skillArray = Object.keys(skills.id);
  //If there are any skills in skills.json that are not in the user profile, add them.
  for(var i=0;i<skills.length;i++){
    if(getSkillXPFromUser(user, skillArray[i])===-1){
      var skillToPush = skillArray[i];
      user.local.characterSkills.push({skillToPush:1}); //Set that skill to 1.
    }
  }
  //If there are any orphaned skills, remove those.
  var playerSkillArray = Object.keys(user.local.characterSkills);
  for(var i=0;i<playerSkillArray.length;i++){
    var skillFound = false;
    for(var q=0;q<skillArray.length;q++){
      if(playerSkillArray[i]===skillArray[q]){
        skillFound = true;
      }
    }
    if(!skillFound){
      user.local.characterSkills.splice(i,1);
    }
  }
  user.save(function(err) {
      if (err)
          throw err;
      return null;
  });
}

//getSkillXPFromUser()
//Given a user and a skill id, return the XP total of the skill. -1 if no skill.
function getSkillXPFromUser(_user,_skillId){
  var user = _user;
  var skillId = _skillId;
  var playerSkillArray = Object.keys(user.local.characterSkills);
  for(var i=0;i<playerSkillArray.length;i++){
    if(playerSkillArray[i]===skillID){
      return user.local.characterSkills[i];
    }
  }
  return -1;
}

//getSkillLevel()
//Given an XP value, return the level associated with it.
function getSkillLevel(val){
  return Math.floor(Math.sqrt(val/10));
}

//tabulateRatings()
//Given a user, output an array of objects for their ratings.
//Can also check the type section of a rating (i.e. get all offencive ratings).
//  Outputs [{"ratingName" : "ratingVal"},...]
function tabulateRatings(user,ratingType){
  var ratingArray = [];
  for(var i;i<ratings.length;i++){
    //Check for type specification
    if(typeof ratingType === "undefined" || ratingType === ratings[i].type){
      var ratingName = Object.keys(ratings[i]);
      //For each linked skill, get a rating. Then use the highest one.
      for(var q;q<ratings[i].linkedSkills.length;q++){
        var skillVal = getSkillLevel(getSkillXPFromUser(user,Object.keys(ratings[i].linkedSkills)[q]));
        var itemVal = tabulateLinkedItems(user,Object.keys(ratings[i].linkedSkills)[q]);
        var weight = ratings[i].linkedSkills[q];
        var ratingVal = Math.ceil(Math.sqrt(skillVal) * Math.sqrt(itemVal) * weight * 10);
      }
      ratingArray.push({ratingName : ratingVal});
    }
  }
  return ratingArray; //Output array
}

//tabulateLinkedItems()
//Given a user and a skill, return the added power of all equipped items that are linked to that skill.
function tabulateLinkedItems(user,skillID){
  var totalPower = 0;
  //Find all linked linkedClasses
  for (var i=0;i<skills.length;i++){
    if(skills[i].id === skillID){
      for(var q=0;q<skills[i].linkedClasses.length;q++){
        //For each linked class, scan through the equipment, adding power for each found item that has the same class.
        for(var p=0;p<user.local.characterEquipment.length;p++){
          if(getClassofEquipment(user.local.characterEquipment[p].typeID)===skills[i].linkedClasses){
            totalPower = totalPower + getEquipmentPower(user.local.characterEquipment[p].typeID);
          }
        }
      } //How many layers until it's too many?
    }
  }
  return totalPower;
}

//listActiveWeaponClasses()
//Given a user, return an array listing the IDs for all the classes they have equipment for.
function listEquippedWeaponClasses(user){
  var equippedClasses = [];
  for(var i=0;i<user.local.characterEquipment.length;i++){
    //Get the skill.
    var classInQuestion = getClassofEquipment(user.local.characterEquipment[p].typeID)
    //ensure the skill isn't already on the array.
    var inArray = false;
    for(var q=0;q<activeSkills.length;q++){
      if(classInQuestion===equippedClasses[q]){
        inArray = true;
        break;
      }
    }
    if(inArray){
      equippedClasses.push(skillInQuestion);
    }
  }
  return equippedClasses;
}

//damagePlayer()
//Takes a user and an int and applies damage to that player.
function damagePlayer(user,damageVal){
  user.local.health = user.local.health - damageVal;
  user.save(function(err) {
      if (err)
          console.log(err);
      return null;
  });
}

//healPlayer()
//Takes a user and an int and adds health to that player, up to their max health.
function healPlayer(user,healVal){
  if((user.health+healVal)>=user.maxHealth){
    user.health=user.maxHealth;
  }else{
    user.health = user.health+healVal;
  }
  user.save(function(err) {
      if (err)
          console.log(err);
      return null;
  });
}

//setAdventuringTag()
//Takes an array of users and a boolean. If the boolean is true, ascribe the adventuring tag to the profile.
function setAdventuringTag(userArray,isAdventuring){
  for(var i=0;i<userArray.length;i++){
    user.local.adventureTag = isAdventuring;
    user.save(function(err) {
        if (err)
            console.log(err);
        return null;
    });
  }
}

//giveXP()
//Takes a user, a skill, and a value.
//Adds XP to that skill.
function addXP(user,skillID,val){
  for(var i=0;i<user.local.characterSkills.length;i++){
    if(Object.keys(user.local.characterSkills[i]) === skillID){
      user.local.characterSkills[i] = user.local.characterSkills[i] + val;
      break;
    }
  }
}

//giveHealthToAllLoggedInPlayers()

function giveHealthToAllLoggedInPlayers(){
  console.log("User List:")
  for(var i=0;i<io.sockets.connected.length;i++){
    console.log(io.sockets.connected[i].userInfo);
  }
}

//giveHealthGainedWhileLoggedOut()
//Given a user, calculate how much health they should have, given the number of minutes they have been logged out.
//Called when a user logs in.
function giveHealthGainedWhileLoggedOut(userInQuestion){
  var currTime = new Date().getTime();
  if(typeof userInQuestion.timeLastLoggedOut==="undefined"){
    userInQuestion.timeLastLoggedOut = currTime;
    user.save(function(err) {
        if (err)
            throw err;
        return null;
    });
    return;
  }
  var timeOfLastLogout = userInQuestion.timeLastLoggedOut.getTime();
  var healthToGive = Math.floor((currTime-timeOfLastLogout)/1000);
  healPlayer(userInQuestion,healthToGive);
}

//travel()
//Takes a user and a location.
//Has the user travel to the new location.
function travel(user,destination){
  // Check if move is valid.
  // If the player is adventuring, they can't move.
  if(user.local.isAdventuring){
    return console.log(user.local.characterName + " is unable to move: adventuring.");
  }
  // Find the room the user is in.
  var currRoom = getUserRoomRef(user.local.characterLocationID);
  //Ensure that said room has that exit.
  var exitIsValid = false;
  for(var i=0;i<currRoom.exits.length;i++){
    if(currRoom.exits[i]===destinationID){
      exitIsValid = true;
      break;
    }
  }
  if(!exitIsValid){
    return console.log('Exit ' + destinationID + ' is invalid.');
  }
  // If so, update the character's position in the database and send them a message.
  user.local.characterLocationID = destinationID;
  user.save(function(err) {
      if (err)
          throw err;
      return null;
  });
  socket.leave('room/'+currRoom.id);
  emitUsersInRoomList(currRoom.id);
  io.to('room/'+currRoom.id).emit('chat message',user.local.characterName + ' exits the ' + currRoom.displayName);
  currRoom = getUserRoomRef(user.local.characterLocationID);
  if(currRoom.type==="plaza"){
    io.to('room/'+user.local.characterLocationID).emit('chat message',user.local.characterName + ' walks into the ' + currRoom.displayName);
    socket.join('room/'+user.local.characterLocationID);
    emitUsersInRoomList(user.local.characterLocationID);
    console.log(user.local.email + ' has moved to ' + destinationID);
    io.to('priv/' + user.id).emit('data: validExits', currRoom.exits);
    io.to('priv/' + user.id).emit('data: currRoom', currRoom.id);
    io.to('priv/' + user.id).emit('chat message', 'You move to the ' + currRoom.displayName);
    io.to('priv/' + user.id).emit('chat message', currRoom.description);
  }
  if(currRoom.type==="dungeon"){
    adventure(user, currRoom.id);
  }

}

//*********ADVENTURE FUNCTIONS************
//adventure()
//Given a dungeon room, adventure in that room.
//Have encounters equal to the number of challenge stages.
//Only have access to a handfull of verbs while adventuring.
//If a challenges is won, give player rewards and upgrade the challenge rating.
//If a challenge is lost but the player is still alive, downgrade the challenge rating.
//If the player dies, have them forfet half of found XP and all found items.
function adventure(userArray, loc){
  //If it's not a dungeon, return an error.
  if(loc.type != "dungeon"){
    return console.log(loc.id + " is not a dungeon");
  }

  var currStage = 0;
  var itemRewardArray = [];
  var xpRewardArray = [];
  var livePlayerArray = userArray;
  var userKilledArray = []; //Takes a user.id and an int, where the in is the challenge state the user died on.
  //Call preventAdventureIllegalVerbs(userArray,true) to prevent players from preforming illegal actions
  //while adventuring.
  setAdventuringTag(userArray,true);
  //Have players travel() to the adventure location.
  //Once they arrive:
  for(var i=0;i<loc.challengeStages;i++){
    challenge(userArray,selectChallenge(loc,currChallengeStage));
    //Adventure Failure state
    if(currStage <= -1 || livePlayerArray.length === 0){
      adventureRetreat(userArray);
    }
  }
  //If the for loop ends and no failure states were called, the party must have survived the adventure.
  adventureVictory(userArray);

  //If the adventure is done, have players travel() back to their starting location.

}

function adventureRetreat(userArray){
  rewardPlayers(userArray,"retreat");
  setAdventuringTag(userArray, false);
  console.log("The group lead by " + userArray[i] + " was forced to retreat.");
}

function adventureVictory(userArray){
  rewardPlayers(userArray,"victory");
  setAdventuringTag(userArray, false);
  console.log("The group lead by " + userArray[i] + " survived.");
}

//rewardPlayers(userArray,rewardType)
//For now, distribute items to everyone and reward type doesn't actually do anything.
function rewardPlayers(userArray,rewardType){
  for(var i=0;i<userArray.length;i++){
    var userKilledOnStage = wasUserKilled(userArray[i])
    if(userKilledOnStage === false){
      //For every tablulated item value over 0, apply the xp total to those skills.
      //i.e. If someone has two swords and one chain armor, give XP for swords and chain armor evenly.
      for(var q=0;q<skills.length;q++){
        if(tabulateLinkedItems(skill[q].id)>0){
          giveXP(userArray[i],skill[q],xpRewardArray.reduce(getSum));
        }
      }
      //Give player all item drops.
      for(var q=0;q<itemRewardArray;q++){
        if(itemRewardArray[q]!="nothing"){
          addItem(userArray[i],itemRewardArray[q]);
        }
      }
    }else{
      var xpTotal = 0;
      for(var q=0;q<userKilledOnStage;q++){
        xpTotal = xpTotal + xpRewardArray[q];
      }
      for(var q=0;q<skills.length;q++){
        if(tabulateLinkedItems(skill[q].id)>0){
          giveXP(userArray[i],skill[q],Math.ceil(xpTotal/4));
        }
      }
    }
  }
}


//selectChallenge(loc,currChallengeStage)
//Given a location and a challenge stage, select a valid challenge.
function selectChallenge(loc,curChallengeStage){
  if(loc.type!="dungeon"){
    return console.log("Error: " + loc.id + " is not a dungeon.");
  }
  //Choose a random challenge from the correct stage.
  var challengeNum = Math.floor(loc.challenges[currChallengeStage].length * Math.random());
  return Object.keys(loc.challenges[currChallengeStage][challengeNum]);
}

//challenge(userArray,challengeID)
//Takes an array of user objects and subjects them to a challenge.
//The users attack() the challenge and defend() against it until the users run out of
//health or morale, OR the challenge runs out of health.
function challenge(userArray,challengeID){
    var challengeHealth = getChallenge(challengeID).health;
    var partyMorale = 100;
    var combat = setInterval(combatRound(userArray,challengeID),1000);
}

//getChallenge(challengeID)
//Given a challenge ID, return a ref to that challenge.
function getChallenge(challengeID){
  for(var i=0;i<challenges.length;i++){
    if(challengeID===challenges[i].id){
      return challenges[i];
    }
  }
  return console.log("Error: challengeID " + challengeID + " not found.");
}

//combatRound(userArray,challengeID)
//A single round of combat
function combatRound(userArray,challengeID){
  attack(livePlayerArray,challengeID);
  defend(livePlayerArray,challengeID);
  //Check if a player has died.
  //If a player has their health depleated, challengeKill() that player.
  for(var i=0;i<userArray.length;i++){
    if(userArray[i].local.health <= 0){
      challengeKill(userArray[i]);
    }
  }
  //Check for end conditions, if there are any, return.
  //If all players are dead, TPK the party.
  if(livePlayerArray.length = 0){
    challengeRetreat(userArray);
  }
  //If morale gone, then challengeRetreat()
  if(partyMorale<=0){
    challengeRetreat(userArray);
  }
  //If victory, then challengeVictory()
  if(challengeHealth<=0){
    challengeVictory(userArray);
  }
}

//attack(userArray,challengeID)
//Takes an array of users and has them attack a challenge.
function attack(livePlayerArray,challengeID){
  //Each player attacks the challenge with a random rating.
  //The chance of what rating is used is determined by how powerful it is relative to the others.
  for(var i=0;i<livePlayerArray.length;i++){
    var ratingsArray = tabulateRatings(livePlayerArray[i],"offencive"); //Get a weighted array of offencive ratings.
    var attackRating = selectKeyFromWeightedArray(ratingsArray); //Choose a rating.

    //From there, roll a number of d3s equal to the rating in question and for every 3, add 1 to the rating.
    var offRatingMod = 0;
    for(var q=0;q<chosenRating;q++){
      if(Math.ceil(Math.random()*3)===3){
        offRatingMod = offRatingMod+1;
      }
    }
    attackRating = attackRating + offRatingMod;
    //Do the same for the challenge's defensive ratings.
    var defRatingID = getRatingRef(Object.keys(attackRating)).defendedBy; //Determine what the challenge should defend with.
    var defRatingArray = getChallenge(challengeID).defRatings;
    var defRating;
    for(var q=0;q<defRatingArray.length;q++){
      if(defRatingID === Object.keys(defRatingArray)[q]){
        defRating = defRatingArray[q];
        break;
      }
    }
    var defRatingMod = 0;
    for(var q=0;q<defRating;q++){
      if(Math.ceil(Math.random()*3)===3){
        defRatingMod = defRatingMod+1;
      }
    }
    defRating = defRatingMod + defRatingMod;
    //Any attack value that exceeds the def value is dealt as damage to health.
    if(attackRating > defRating){
      challengeHealth = challengeHealth - (attackRating - defRating);
    }
    console.log(user.local.characterName + " attacks " + challengeID + " with a " + attackRating + ". " + challengeID + " defends with a " + defRating + "!");
  }
}

//defend(userArray,challengeID)
//Takes an array of users and a challenge and has users get attacked by it.
function defend(userArray,challengeID){
  var challengeRef = getChallenge(challengeID);
  var attackerRatingArray = challengeRef.offRatings;
  //Make a number of attacks equal to challengeRef.attacks.
  for(var i=0; i<challengeRef.attacks;i++){
    var challengeAttack = selectKeyFromWeightedArray(attackerRatingArray); //Have the challenge choose an attack.
    //Roll a number of d3s equal to the rating in question and for every 3, add 1 to the rating.
    var offRatingMod = 0;
    for(var q=0;q<chosenRating;q++){
      if(Math.ceil(Math.random()*3)===3){
        offRatingMod = offRatingMod+1;
      }
    }
    challengeAttack = challengeAttack + offRatingMod;

    var userUnderAttack = livePlayerArray[Math.ceil(Math.random()*livePlayerArray.length)]; //Determine which user to attack from the live player list.
    var userUnderAttackDefSkills = tabulateRatings(userUnderAttack,"defencive"); //Grab that user's defence skills
    var defSkill = (getRatingRef(Object.keys(challengeAttack)).defendedBy);
    var userDefenceRating = userUnderAttackDefSkills.defSkill; //Grab the specific def skill we need.
    //Roll a number of d3s equal to the rating in question and for every 3, add 1 to the rating.
    var defRatingMod = 0;
    for(var q=0;q<userDefenceRating;q++){
      if(Math.ceil(Math.random()*3)===3){
        defRatingMod = defRatingMod+1;
      }
    }
    userDefenceRating = userDefenceRating + defRatingMod;
    if(challengeAttack > userDefenceRating){
      damagePartyMorale(challengeAttack-userDefenceRating);
      damagePlayer(userUnderAttack,(challengeAttack-userDefenceRating));
      //Check if player was killed by this attack.
      if(userUnderAttack.local.health<=0){
        challengeKill(userUnderAttack);
      }
    }
  }
}

//challengeKill()
//Given a player in a challenge, take them off the live player list and put them on the dead player list.
//The dead player list consists of their user ID and an int describing what stage they died on.
function challengeKill(user){
  for(var i=0;i<livePlayerArray.length;i++){
    if(livePlayerArray[i].id===user.id){
      livePlayerArray.splice(i,1);
      var userKilledID = user.id;
      userKilledArray.push({userKilledID:currStage});
    }
  }
}

//damagePartyMorale()
function damagePartyMorale(damageVal){
    partyMorale = partyMorale - damageVal;
}

//challengeRetreat(userArray)
//Have players retreat from a challenge.
function challengeVictory(userArray){
  //End the combat timer.
  clearInterval(combat);
  //Increase the stage.
  currStage++;
}

//challengeRetreat(userArray)
//Have players retreat from a challenge.
function challengeRetreat(userArray){
  //End the combat timer.
  clearInterval(combat);
  //Decrease the stage.
  currStage--;
}

//********MISC FUNCTIONS******************
//createGUID()
//Courtesy of StackOverflow
function createGUID(){
  return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
    s4() + '-' + s4() + s4() + s4();
}
function s4() {
  return Math.floor((1 + Math.random()) * 0x10000)
    .toString(16)
    .substring(1);
}

//Given a rating ID, return a ref to that rating's data.
function getRatingRef(ratingID){
  for(var i=0;i<ratings.length;i++){
    if(ratingID===ratings[i].id){
      return ratings[i];
    }
  }
  return console.log("Error: ratingID " + ratingID + " not found.");
}

//selectKeyFromWeightedArray()
//Given an array of key-weight pairs, choose a key at random.
function selectKeyFromWeightedArray(weightedArray){
  //Add up the weights
  var sumOfWeights = 0;
  var weightCutoffs = []; //Details which ratings go with which ranges.
  for(var i=0;i<weightedArray.length;i++){
      sumOfWeights = sumOfWeights + weightedArray[i];
      weightCutoffs.push(sumOfWeights);
  }
  //Calculate a random number
  var keySelector = Math.random()*sumOfWeights;
  //Determine which weightCutoff this number belongs to.
  for(var i=0;i<weightCutoffs.length;i++){
    if(keySelector <= weightCutoffs[i]){
      return weightedArray[i];
    }
  }
}

//Get a sum
function getSum(total, num) {
    return total + num;
}

//Get an array of all logged-in users.
function getLoggedInUserMap(userModel){
  var loggInUserMap = {};

  console.log(loggInUserMap);
  return loggInUserMap;
}
