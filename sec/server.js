//server.js

//set up
//Get what we need
var express   = require('express');
var app       = express();
var port      = process.env.PORT || 8080;
var mongoose  = require('mongoose');
var passport  = require('passport');
var flash     = require('connect-flash');

var morgan       = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser   = require('body-parser');
var session      = require('express-session');

var configDB = require('./config/database.js');

// configuration
mongoose.connect(configDB.url); //Connect to our database.

// require('./config/passport')(passport); // pass passport for configuration

// setup express application
app.use(morgan('dev'));
app.use(cookieParser());
app.use(bodyParser());

app.set('view engine', 'ejs');

// for passport

app.use(session({ secret: 'its a secret to everybody'}));
app.use(passport.initialize());
app.use(passport.session());
app.use(flash());

//routes
require('./app/routes.js')(app, passport); // load our routes and pass in our app and fully configured passport

// launch
app.listen(port);
console.log('Auth listening on ' + port);
