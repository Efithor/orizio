var place = function(_displayName,_description){
  this.displayName = _displayName;
  this.description = _description;
  this.exits = [];
};
// =============================================================================
// PLACES ======================================================================
// =============================================================================

// Front Walk
// The starting point of the adventure.
// Exits to the Foyer.
var frontWalk = new place("Front Walk", "You stand on a cobblestone path leading to a large manor house. The air is warm and windless.");

// Foyer
// A nexus of rooms
// Exits to the Front Walk, Dining Room, and Sitting Room.
var foyer = new place("Foyer", "You stand in the foyer. A too-bright chandelier hangs from the ceiling. An archway to your left leads to the dining room. Another arch to your right leads to the Sitting Room.");

// Dining Room.
// A place where food could be served.
// Exits to the Foyer and the Kitchen.
var diningRoom = new place("Dining Room", "You stand in the dining room. There is a door to the kitchen.");

// Sitting Room
// A place for sitting.
// Exits to the Foyer.
var sittingRoom = new place("Sitting Room", "You are standing in the Sitting Room. Huh.");

// Kitchen
// A place of preparing food.
// Exits to the Dining Room.
var kitchen = new place("kitchen", "You stand in the Kitchen. There's an exit to the Dining Room.");

// ASSOCIATE EXITS
// Now that the rooms are created, let's link them up.
fontWalk.exits = [foyer];

foyer.exits = [frontWalk,diningRoom,sittingRoom];

diningRoom.exits = [foyer,kitchen];

kitchen.exits = [diningRoom];

sittingRoom.exits = [foyer];
