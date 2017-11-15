// app/models/user.js
// load the things!
var mongoose = require('mongoose');
mongoose.set('debug', true);

var bcrypt   = require('bcrypt-nodejs');

// load web token tool
var jwt = require('jsonwebtoken');

//define the schema for the user model
var userSchema = mongoose.Schema({

  local       : {
    id        : String,
    email     : String,
    password  : String,
    socToken  : String
  },
  google        : {
    id          : String,
    token       : String,
    displayName : String,
    username    : String
  }

});

// Methods
// Generating a hash
userSchema.methods.generateHash = function(password) {
  return bcrypt.hashSync(password, bcrypt.genSaltSync(12), null);
};

//Checking if valid
userSchema.methods.validPassword = function(password) {
  return bcrypt.compareSync(password, this.local.password);
};
// create token
userSchema.methods.createToken = function(payload, secret) {
  return jwt.sign(payload, secret);
}
// create the model for users and expose it.
module.exports = mongoose.model('User', userSchema);
