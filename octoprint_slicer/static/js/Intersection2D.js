'use strict';

// Test if triangles intersect in 2D.
var Intersection2D = {
  // Triangles is an object with points a,b,c.  Each point is an
  // object with x and y.  Returns true if any of the triangles
  // intersect.

  // From: http://blackpawn.com/texts/pointinpoly/default.html
  sameSide: function(p1, p2, a, b) {
    var ab = {x: b.x-a.x, y: b.y-a.y};
    var ap1 = {x: p1.x-a.x, y: p1.y-a.y};
    var ap2 = {x: p2.x-a.x, y: p2.y-a.y};
    var cp1 = (ab.x * ap1.y -
               ab.y * ap1.x);
    var cp2 = (ab.x * ap2.y -
               ab.y * ap2.x);
    var dp = cp1 * cp2;
    return dp >= 0;
  },
  pointInTriangle: function(p, t) {
    return (Intersection2D.sameSide(p,t.a,t.b,t.c) &&
            Intersection2D.sameSide(p,t.b,t.a,t.c) &&
            Intersection2D.sameSide(p,t.c,t.a,t.b));
  },
  trianglesIntersect: function(t0,t1) {
    return (Intersection2D.pointInTriangle(t0.a, t1) ||
            Intersection2D.pointInTriangle(t0.b, t1) ||
            Intersection2D.pointInTriangle(t0.c, t1) ||
            Intersection2D.pointInTriangle(t1.a, t0) ||
            Intersection2D.pointInTriangle(t1.b, t0) ||
            Intersection2D.pointInTriangle(t1.c, t0));
  },
  // An object is a list of 2D triangles.
  objectsOverlap: function(o1,o2) {
    for (var i1 = 0; i1 < o1.length; i1++) {
      for (var i2 = i1+1; i2 < o2.length; i2++) {
        if (Intersection2D.trianglesIntersect(o1[i1], o2[i2])) {
          return true;
        }
      }
    }
    return false;
  },
  // Convert a ThreeJS geometry to a list of triangles.
  object3DToTriangles: function(o) {
    var g = new THREE.Geometry();
    g.fromBufferGeometry(o.children[0].geometry);
    var triangles = [];
    for (var faceIndex = 0; faceIndex < g.faces.length; faceIndex++) {
      var face = g.faces[faceIndex];
      var triangle3d = {a: o.localToWorld(g.vertices[face.a]),
                        b: o.localToWorld(g.vertices[face.b]),
                        c: o.localToWorld(g.vertices[face.c])};
/*      if (triangle3d.a.x == triangle3d.b.x && triangle3d.a.y == triangle3d.b.y ||
          triangle3d.a.x == triangle3d.c.x && triangle3d.a.y == triangle3d.c.y ||
          triangle3d.b.x == triangle3d.c.x && triangle3d.b.y == triangle3d.c.y) {
        // Degenergate trinagle in 2d, skip.
      } else {*/
      triangles.push(triangle3d);
      //}
    }
    return triangles;
  },
  /*
  // Convert a ThreeJS Object3Ds to geometry to a list of triangles.
  object3DTo2DOutline: function(o) {
    var g = new THREE.Geometry();
    g.fromBufferGeometry(o.children[0].geometry);

    var leftmostVertex = g.vertices[0];
    for (var vertexIndex = 1; vertexIndex < g.vertices.length; vertexIndex++) {
      if (g.vertices[i].x < leftmostVertex.x ||
          (leftmostVertex.x == g.vertices[i].x &&
           leftmostVertex.y <  g.vertices[i].y)) {
        leftmostVertex = g.vertices[i];
      }
    }
    var edges = {};
    for (var faceIndex = 0; faceIndex < g.faces.length; faceIndex++) {
      var face = g.faces[faceIndex];
      var a = o.localToWorld(g.vertices[face.a]);
      var b = o.localToWorld(g.vertices[face.b]);
      var c = o.localToWorld(g.vertices[face.c]);
      
      if (!edges.hasOwnProperty(a.x)) {
        edges[a.x] = {};
      }
      if (!edges[a.x].hasOwnProperty(a.y)) {
        edges[a.x][a.y] = [];
      }
      edges[a.x][a.y].push(b);
      edges[a.x][a.y].push(c);
      
      if (!edges.hasOwnProperty(b.x)) {
        edges[b.x] = {};
      }
      if (!edges[b.x].hasOwnProperty(b.y)) {
        edges[b.x][b.y] = [];
      }
      edges[b.x][b.y].push(a);
      edges[b.x][b.y].push(c);

      if (!edges.hasOwnProperty(c.x)) {
        edges[c.x] = {};
      }
      if (!edges[c.x].hasOwnProperty(c.y)) {
        edges[c.x][c.y] = [];
      }
      edges[c.x][c.y].push(a);
      edges[c.x][c.y].push(b);
    }

    var surroundingPoints = [leftmostVertex];
    var currentVertex = leftmostVertex;
    var previousVertex = {"x": leftmostVertex.x-1, "y": leftmostVertex.y, "z": leftmostVertex.z};
    do {
      var closestVertex = edges[currentVertex.x][currentVertex.y];  // closest means smallest angle.
      var closestAngle = Intersection2D.angle(previousVertex, currentVertex, closestVertex);
      for (var i = 1; i < edges[currentVertex.x][currentVertex.y].length; i++) {
        var newVertex = edges[currentVertex.x][currentVertex.y][i];
        var newAngle = Intersection2D.angle(previousVertex, currentVertex, newVertex);
        if (newAngle < 
        //compute angle to 
      }
    } while (currentVertex.x != leftmostVertex.x ||
             currentVertex.y != leftmostVertex.y);
    return triangles;
  },*/

  angle: function(a,b,c) {
    var v0 = {"x": a.x-b.x, "y": a.y-b.y};
    var v1 = {"x": c.x-b.x, "y": c.y-b.y};
    var angle = Math.atan2(v1.y,v1.x) - Math.atan2(v0.y,v0.x);
    if (angle < 0) {
      angle += 2*Math.PI;
    }
    return angle;
  }
};

// browserify support
if ( typeof module === 'object' ) {
  module.exports = RectanglePacker;
}
