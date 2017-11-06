// app.routes.js
module.exports = function(app, passport) {

    //Home Page
    app.get('/', function(req, res) {
      res.render('index.ejs'); //load index.ejs
    });

    //Login
    //Show Login form
    app.get('/login', function(req, res) {

      res.render('login.ejs', { message: req.flash('loginMessage') });
    });

    // process the signup form
    // app.port('/signup', do all our passport stuff here);

    //Profile
    // we will want this protected so you have to be logged in to visit
    // we will use route middleware to verify this (the isLoggedIn function)
    app.get('/profile', isLoggedIn, function(req, res) {
      res.render('profile.ejs', {
        user : req.user //Get the user out of session and pass to template
      });
    });

    //Logout
    app.get('/logout', function(req, res) {
      req.logout();
      res.redirect('/');
    });
};

// route middleware to make sure a user is logged in
function isLoggedIn(req, res, next) {

  // if user is authenticated in the session, carry on
  if (req.isAuthenticated())
    return next();

  //if they aren't, redirect them to the home page.
  res.redirect('/');
}
