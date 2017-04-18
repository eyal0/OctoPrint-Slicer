import babel from 'rollup-plugin-babel';
import babelrc from 'babelrc-rollup';
import nodeResolve from 'rollup-plugin-node-resolve';

let pkg = require('./package.json');

export default {
  entry: 'src/CollisionDetectorWorker.js',
  plugins: [
    babel(babelrc()),
    nodeResolve({
             jsnext: true,
             main: true,
             browser: true,
    }),
  ],
  dest: 'octoprint_slicer/static/js/CollisionDetectorWorker.min.js',
  format: 'iife',
  sourceMap: false
};
