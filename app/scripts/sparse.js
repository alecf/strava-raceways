SparseArray = (function() {
  /**
   * A lazy deep dictionary. Pass keys as arguments, and dicts will be
   * created lazily along the way.
   *
   * Usage:
   * SparseArray(bucket, x1,y1,z1).foo = 'bar';
   * SparseArray(bucket, x2,y2,z2).name = 'baz'
   *
   * Now bucket[x1][y1][z1].foo == 'bar'
   */

  function SparseArray(bucket) {
    // chop off 'bucket'
    var keys = Array.prototype.slice.call(arguments, 1);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (!(key in bucket)) {
        bucket[key] = {};
      }
      bucket = bucket[key];
    }
    return bucket;
  }

  return SparseArray;
})();
