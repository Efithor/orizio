module.exports.checkData = checkData;

  function checkData(_challenges,_itemClasses,_items,_places,_ratings,_skills){
    var challenges = _challenges;
    var itemClasses = _itemClasses;
    var items = _items;
    var places = _places;
    var ratings = _ratings;
    var skills = _skills;

    //Validate items file
    checkItems(items,itemClasses);
    //Validate skills file.
    checkSkills(skills,itemClasses);
    //Validate ratings file.
    checkRatings(ratings,skills);
    //Validate challenges file.
    checkChallenges(challenges,ratings,items);
    //Validate places file.
    checkPlaces(places);

    console.log('All data validated.');
  }


function checkItems(_items,itemClasses){
  var items = _items;
  //Ensure no duplicate items.
  for(var i=0;i<items.length;i++){
    //Check for duplicate IDs
    for(var q=(i+1);q<items.length;q++){
      if(items[i].id===items[q].id){
        throw console.log('Error: Duplicate Item ID' + items[q].id + 'found.')
      }
    }
    //Check to ensure all linked classes are linked to an actual weapon class.
    var classIsValid = false;
    for(var s=0;s<itemClasses.length;s++){
        if(items[i].class===itemClasses[s]){
          classIsValid = true;
        }
    }
      if(!classIsValid)
        throw console.log('Error: Weapon Class for'+ items[i].id + 'is Invalid.')
  }
}
function checkSkills(_skills,itemClasses){
  var skills = _skills;
  //Ensure no duplicate skills
  for(var i=0;i<skills.length;i++){
    //Check for duplicate IDs
    for(var q=(i+1);q<skills.length;q++){
      if(skills[i].id===skills[q].id){
        throw console.log('Error: Duplicate Skill ID' + skill[q].id + 'found.')
      }
    }
    //Ensure all linked weapon classes are legit.
    for(var t=0;t<skills[i].linkedClasses.length;t++){
      var classIsValid = false;
      for(var s=0;s<itemClasses.length;s++){
        if(skills[i].linkedClasses[t]===itemClasses[s]){
          classIsValid = true;
        }
      }
      if(!classIsValid)
        throw console.log('Error: item class for '+skills[i].id+' Invalid.')
    }
  }
}
function checkRatings(_ratings,skills){
  var ratings = _ratings;
  //Ensure no duplicate ratings.
  for(var i=0;i<ratings.length;i++){
    //Check for duplicate IDs
    for(var q=(i+1);q<ratings.length;q++){
      if(ratings[i].id===ratings[q].id){
        throw console.log('Error: Duplicate rating ID' + ratings[q].id + 'found.')
      }
    }
    //Ensure all linked skills exsist.
    for(var t=0;t<ratings[i].linkedSkills.length;t++){
      var skillIsValid = false;
      for(var s=0;s<skills.length;s++){
        if(Object.keys(ratings[i].linkedSkills[t])[0]===skills[s].id){
          skillIsValid = true;
        }
      }
      if(!skillIsValid)
        throw console.log('Error: Linked Skill for '+ratings[i].id+' Invalid.')
    }
  }
}
function checkChallenges(_challenges,ratings,items){
  var challenges = _challenges;
  //Ensure no duplicate challenges.
  for(var i=0;i<challenges.length;i++){
    //Check for duplicate IDs
    for(var q=(i+1);q<challenges.length;q++){
      if(challenges[i].id===challenges[q].id){
        throw console.log('Error: Duplicate Challenge ID' + places[q].id + 'found.')
      }
    }
    //Ensure challenges have valid Offensive ratings.
    for(var t=0;t<challenges[i].offRatings.length;t++){
      var ratingIsValid = false;
      for(var s=0;s<ratings.length;s++){
          if(Object.keys(challenges[i].offRatings[t])[0]===ratings[s].id){
            ratingIsValid = true;
          }
        }
        if(!ratingIsValid){
            throw console.log('Error: Challenge rating'+Object.keys(challenges[i].offRatings)[t]+' invalid.')
        }
      }
      //Ensure challenges have valid Defensive ratings.
      for(var t=0;t<challenges[i].defRatings.length;t++){
        var ratingIsValid = false;
        for(var s=0;s<ratings.length;s++){
            if(Object.keys(challenges[i].defRatings[t])[0]===ratings[s].id){
              ratingIsValid = true;
            }
          }
          if(!ratingIsValid){
              throw console.log('Error: Challenge rating'+Object.keys(challenges[i].defRatings[t])[0]+' invalid.')
          }
        }
        //Ensure challenges have valid rewards.
        for(var t=0;t<challenges[i].rewards.length;t++){
          var itemIsValid = false;
          for(var s=0;s<items.length;s++){
              if(Object.keys(challenges[i].rewards[t])[0] === "nothing" || Object.keys(challenges[i].rewards[t])[0]===items[s].id){
                itemIsValid = true;
              }
            }
            if(!itemIsValid){
                throw console.log('Error: item reward ' + Object.keys(challenges[i].rewards[t])[0] + ' is invalid.')
            }
          }

    }


}
function checkPlaces(_places){
  var places = _places;
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
}
