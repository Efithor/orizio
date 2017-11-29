
function place(_displayName,_description,_exits){
  this.displayName = _displayName;
  this.description = _description;
  this.exits = [];
};

// =============================================================================
// PLACES ======================================================================
// =============================================================================
var placeArray = [];
// Front Walk
// The starting point of the adventure.
// Exits to the Foyer.
this.frontWalk = new place('Front Walk', 'You stand on a cobblestone path leading to a large manor house. The air is warm and windless.');
placeArray.push(this.frontWalk);

// Foyer
// A nexus of rooms
// Exits to the Front Walk, Dining Room, and Sitting Room.
this.foyer = new place("Foyer", "You stand in the foyer. A too-bright chandelier hangs from the ceiling. An archway to your left leads to the dining room. Another arch to your right leads to the Sitting Room.");
placeArray.push(this.foyer);

// Dining Room.
// A place where food could be served.
// Exits to the Foyer and the Kitchen.
this.diningRoom = new place("Dining Room", "You stand in the dining room. There is a door to the kitchen.");
placeArray.push(this.diningRoom);

// Sitting Room
// A place for sitting.
// Exits to the Foyer.
this.sittingRoom = new place("Sitting Room", "You are standing in the Sitting Room. Huh.");
placeArray.push(this.sittingRoom);

// Kitchen
// A place of preparing food.
// Exits to the Dining Room.
this.kitchen = new place("kitchen", "You stand in the Kitchen. There's an exit to the Dining Room.");
placeArray.push(this.kitchen);

// ASSOCIATE EXITS
// Now that the rooms are created, let's link them up.
this.frontWalk.exits = [this.foyer];
this.foyer.exits = [this.frontWalk,this.diningRoom,this.sittingRoom];

this.diningRoom.exits = [this.foyer,this.kitchen];

this.kitchen.exits = [this.diningRoom];

this.sittingRoom.exits = [this.foyer];


//Export
module.exports = {placeArray};
