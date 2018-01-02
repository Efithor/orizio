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
var items = require('./app/gamedata/items.json');
var places = require('./app/gamedata/places.json');
var ratings = require('./app/gamedata/ratings.json');
var skills = require('./app/gamedata/skills.json');

var checkData = require('./app/datachecks.js');

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
datacheck.checkData(challenges,items,places,ratings,skills);

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
        // First find the room the user is in.
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
        //Update localFolksList for the left room
        io.to('room/'+user.local.characterLocationID).emit('chat message',user.local.characterName + ' vanishes from the ' + getUserRoomRef(user.local.characterLocationID).displayName);
        emitUsersInRoomList(user.local.characterLocationID);
      })

      //VERB: GET INVENTORY
      socket.on('getInventory', function(){
        io.to('priv/' + user.id).emit('data: inventory', user.local.inventory);
      })

      //VERB: REMOVE ITEM FROM INVENTORY
      socket.on('discardItem', function(itemGUID){
        removeItemFromInventory(user, itemGUID);
        io.to('priv/' + user.id).emit('data: inventory', user.local.inventory.);
      })

      //VERB: EQUIP ITEM
      //Move an item from inventory to equipped.
      socket.on('equipItem', function(itemGUID){
        moveItemFromInventoryToEquipment(user, itemGUID);
        io.to('priv/' + user.id).emit('data: inventory', user.local.inventory.);
        io.to('priv/' + user.id).emit('data: equipment', user.local.equipment);
      })

      //VERB: UNQUIP ITEM
      //Move an item from equipped to inventory.
      socket.on('unequipItem', function(itemGUID){
        moveItemFromEquipmentToInventory(user, itemGUID);
        io.to('priv/' + user.id).emit('data: inventory', user.local.inventory.);
        io.to('priv/' + user.id).emit('data: equipment', user.local.equipment);
      })

      //VERB: GET EQUIPMENT
      // Pass an object to the client listing their equipment.
      socket.on('getEquipment', function(){
        io.to('priv/' + user.id).emit('data: equipment', user.local.equipment);
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
    return console.log(user.local.username + ' cannot discard ' + itemToRemoveGUID '. Item not found.');
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
    return console.log(user.local.username + ' cannot remove ' + itemToRemoveGUID '. Item not found.');
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

//setupCharacterSkills()_
//Given a user, if they're missing any skills, set those to 1.
function setupCharacterSkills(_user){
  var user = _user;
  var skillArray = Object.keys(skills.id);
  //If there are any skills in skills.json that are not in the user profile, add them.
  for(var i=0;i<skills.length;i++){
    if(getSkillFromUser(user, skillArray[i])===-1){
      user.local.characterSkills.push({playerSkillArray[i]):1}); //Set that skill to 1.
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

//getSkillFromUser()
//Given a user and a skill id, return the value of the skill. -1 if no skill.
function getSkillFromUser(_user,_skillId){
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

//tabulateRatings()
//Given a user, output an array of objects for their ratings.
//  Outputs [{"ratingName" : "ratingVal"},...]
function tabulateRatings(user){
  var ratingArray = [];
  for(var i;i<ratings.length;i++){
      var ratingName = Object.keys(ratings[i]);
      //For each linked skill, get a rating. Then use the highest one.
      for(var q;q<ratings[i].linkedSkills.length;q++){
        var skillVal = getSkillFromUser(user,Object.keys(ratings[i].linkedSkills)[q]);
        var itemVal = tabulateLinkedItems(user,Object.keys(ratings[i].linkedSkills)[q]);
        var weight = ratings[i].linkedSkills[q];
        var ratingVal = Math.ceil(Math.sqrt(skillVal) * Math.sqrt(itemVal) * weight * 10);
      }
      ratingArray.push({ratingName : ratingVal});
  }

  return ratingArray; //Output array
}

//tabulateLinkedItems()
//Given a user and a skill, return the added power  of all equipped items that are linked to that skill.
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

//*********ADVENTURE FUNCTIONS************
//adventure()
//Given a dungeon room, adventure in that room.
function adventure(user, loc){
  //If it's not a dungeon, return an error.
  if(loc.type != "dungeon"){
    return console.log(loc.id + " is not a dungeon");
  }
  //Have encounters equal to the number of challenge stages.
  //If a challenges is won, give player rewards and upgrade the challenge rating.
  //If a challenge is lost but the player is still alive, downgrade the challenge rating.
  //If the player dies, have them forfet half of found XP and all found items.

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
