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
var places = require('./app/gamedata/places.json');


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

//Ensure Gamedata is valid. Might want to move this into its own file when there's lots of data.
console.log('Validating Gamedata...');
//Run some checks to make sure the place file is valid.
//I.E, no dup IDs, exits all exit somewhere.
for(var i=0;i<places.length;i++){
  //Check for duplicate IDs
  for(var q=(i+1);q<places.length;q++){
    if(places[i].id===places[q].id){
      throw console.log('Error: Duplicate Place ID' + places[q].id + 'found.')
    }
  }
  //Check to ensure all exits exit somewhere real.
  for(var t=0;t<places[i].exits.length;t++){
    var exitIsValid = false;
    for(var s=0;s<places.length;s++){
        if(places[i].exits[t]===places[s].id){
          exitIsValid = true;
        }
    }
    if(!exitIsValid)
      throw console.log('Error: Exit Invalid.')
  }
}
console.log('All data validated.');

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
          return changeCharName(user,msg,socket);
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
        //io.to('room/'+currRoom.id).emit('data: localFolksList', );
        //Update localFolksList for the left room
        currRoom = getUserRoomRef(user.local.characterLocationID);
        io.to('room/'+user.local.characterLocationID).emit('chat message',user.local.characterName + ' walks into the ' + currRoom.displayName);
        socket.join('room/'+user.local.characterLocationID);
        emitUsersInRoomList(user.local.characterLocationID);
        //Update localFolksList for the joined room
        console.log(user.local.email + ' has moved to ' + destinationID);
        io.to('priv/' + user.id).emit('data: validExits', currRoom.exits);
        io.to('priv/' + user.id).emit('data: currRoom', currRoom.id);
        io.to('priv/' + user.id).emit('chat message', 'You move to the ' + currRoom.displayName);
        io.to('priv/' + user.id).emit('chat message', currRoom.description);
      })
      //VERB: DISCONNECT
      socket.on('disconnect', function(){
        //Update localFolksList for the left room
        io.to('room/'+user.local.characterLocationID).emit('chat message',user.local.characterName + ' vanishes from the ' + getUserRoomRef(user.local.characterLocationID).displayName);
        emitUsersInRoomList(user.local.characterLocationID);
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

//Functions
//Given a user, return a ref to the room they're in.
function getUserRoomRef(user){
  for(var i=0;i<places.length;i++){
    if(user===places[i].id){
      return places[i];
    }
  }
}
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
      user.local.characterCreated = true;
      user.save(function(err) {
          if (err)
              throw err;
          return null;
      });
      console.log('[NAMING]' + user.local.email + ' has named themselves ' + user.local.characterName);
      io.to('priv/' + user.id).emit('chat message', 'You have named yourself ' + user.local.characterName);
      return manifestPlayerCharacter(user,socket);
    }
  });
}
//Check if a location is on a valid location.
function validLocationID(locID){
  for(var i=0;i<places.length;i++){
    if(places[i].id===locID){
      return true;
    }
  }
  return false;
}

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
