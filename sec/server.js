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

//routes
require('./app/routes.js')(app, passport); // load our routes and pass in our app and fully configured passport

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
        throw err;

      //If user is banned, block user.
      if(user.local.accountBanned)
        return 'User unable to connect: banned.'

      //If the user's location is either null or DNA, set the user's location to the starting area.
      //REWORK AFTER CHANGING DATA FILES
      function locationValid(loc){
        if(loc==null){
          return false;
        }
        for(i=0;i<places.length;i++){
          if(loc==places[i].displayName){
            return true;
          }
        }
        return false;
      };
      if(!locationValid(user.local.characterLocation)){
        console.log(user.local.email + ' has an invalid position.')
        user.local.characterLocation = places[0];
        user.save(function(err) {
            if (err)
                throw err;
            return null;
        });
      };

      //All is good, the user has connected!
      console.log(user.local.email + ' connected');

      // ============================================
      // SERVER SIDE VERB LIST ======================
      // ============================================
      // Might want to move this into its own file at some point in the future.

      // VERB: Create Character
      // If 'characterCreated' flag is 'false', this is the only verb they can access.
      socket.on('name character', function(msg){
        //Check if verb is valid.
        if(user.local.characterCreated)
            return console.log('Invalid verb!');

        //Check to see if anone else has that name.
        User.findOne({ 'local.characterName' : msg}, function(err, otherUser) {
          //If there's an error, return it.
          if (err)
            return err;

          if(otherUser) {
            return console.log(msg + ' is already taken.');
          } else{
            //Change the character's name
            user.local.characterName = msg;
            user.local.characterCreated = true;

            user.save(function(err) {
                if (err)
                    throw err;
                return null;
            });
            console.log('[NAMING]' + user.local.email + ' has named themselves ' +msg);
          }
        });
      });
      // VERB: CHAT
      socket.on('chat message', function(msg){
        //Determine if verb is valid
        if(!user.local.characterCreated)
          return console.log('Invalid verb!');

        console.log('[CHAT] ' + user.local.characterName + ': ' + msg);
        io.emit('chat message', user.local.characterName + ': ' + msg);
      })
      //VERB: MOVE
      //REWORK AFTER CONVERTING DATA FILES
      socket.on('char move', function(destination){
        // Determine if the move is valid.
        // Check if the destination in the move is listed among the exits.
        for(i=0;i<user.local.characterLocation.exits.length;i++){
          if(user.local.characterLocation.exits[i] == destination){
            //If exit found, find that room.
            for(q=0;q<places.length;q++){
              if(places[q].displayName == destination){
                //If the room was found, move the player there.
                user.local.characterLocation = places[q];
                user.save(function(err) {
                    if (err)
                        console.log(err);
                    return null;
                });
                socket.to(socket.id).emit('chat message', 'You move to ' + user.local.characterLocation.displayName);
                socket.to(socket.id).emit('chat message', user.local.characterLocation.description);
                return console.log(user.local.characterName + ' has moved to '+ destination);
              }else{
                return console.log(user.local.characterName + ' cannot move to '+ destination + ' as that room was not found.');
              }
            }
          }else{
            return console.log(user.local.characterName + ' cannot move to '+ destination + ' as that is not an exit.');
          }
        }
      })
      return user;
    });
});
// launch
server.listen(3000, function(){
  console.log('chat listening on :3000');
  //console.log(places.frontWalk.description);
});

app.listen(port);
console.log('Auth listening on ' + port);
