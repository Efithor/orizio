// app/models/user.js
// load the things!
var mongoose = require('mongoose');
var bcrypt   = require('bcrypt-nodejs');

//define the schema for the user model
var userSchema = mongoose.Schema({

  local       : {
    email     : String,
    password  : String,
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
  return bcrypt.hashSync(password, bcrypt.genSaltSync(8), null);
};

//Checking if valid
userSchema.methods.validPassword = function(password) {
  return bcrypt.compareSync(password, this.local.password);
};

// create the model for users and expose it.
module.exports = mongoose.model('User', userSchema);
