'use strict';

import { CollisionDetector } from './CollisionDetector';

// collisions is an array of true/false/undefined.  true means
// colliding, false means no, undefined means that we haven't
// figured it out yet.
var callbackFn = function(collisions) {
    console.log('Posting message back to main script');
    postMessage(collisions);
}
var collisionDetector = new CollisionDetector(callbackFn);

onmessage = function(e) {
    console.log('Message received from main script');
    collisionDetector.start(e.data.objects, e.data.volume, e.data.timeoutMilliseconds);
}
