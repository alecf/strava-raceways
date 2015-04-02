// an object that represents a set of streams, and metadata about
// those streams.

// requires d3.js and lodash
StreamSet = (function() {

/**
 * Create a new streamset
 *
 * @param activities A list of metadata about activities.
 * @param xhrContext Context for making further XHR calls.
 * @param resolution 'high' / 'medium' / 'low'
 */
function StreamSet(activities, xhrContext, resolution, proximity_sample) {
    this.xhr_ = xhrContext;
    this.activities_ = activities;
    this.resolution = resolution;
}

  // Get a stream and attach it to the activity. Returns a promise that
  // resolves to a copy of the activity, and a 'stream' property with
  // stream data.
  StreamSet.prototype.load_stream = function(activity) {
    var activity_id = activity.activity_id;
    if (activity.stream)
      return Promise.resolve(activity);
    return this.xhr_('/api/streams', {activity_id: activity_id,
                                      resolution: this.resolution })
      .then(function(streams) {
        var stream = streams.result.streams[activity_id];
        if (!stream.latlng ||
            !stream.latlng.data) {
          console.log("Missing latlng: ", stream.latlng);
          return activity;
        }
        var geojson = {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: stream.latlng.data.map(function(latlng, i) {
              // geojson uses lnglat
              return [latlng[1], latlng[0],
                      stream.altitude.data[i]];
            })
          }
        };
        stream.geojson = geojson;
        activity.stream = stream;
        return activity;
      });
  };


  // Returns a promise that resolves the an array of all activities
  StreamSet.prototype.load_streams = function(activities) {
    var results = [];
    for (var i = 0; i < activities.length; ++i) {
      results.push(this.load_stream(activities[i]));
    }
    return Promise.all(results)
      .then(function(e) {
        console.log("Streams loaded (", results.length, ')');
        return e;
      });
  };


  StreamSet.prototype.ready = function() {
    if (!this.ready_) {
      this.ready_ =
        this.load_streams(this.activities_)
        .then(index_streams)
        .then(this.consume_index.bind(this))
        .catch(function(ex) {
          console.error("Error loading and indexing: ", ex);
        });
    }
    return this.ready_;
  };

  function join_geojsons(geojsons) {
    return {
      type: 'FeatureCollection',
      features: geojsons,
    };
  }

  // xxx need a better name
  StreamSet.prototype.consume_index = function(stream_indexes) {

    this.features = join_geojsons(stream_indexes.map(function(metadata) {
      return metadata.geojson;
    }));

    var extents = this.extents_ = {
      min_lat: d3.min(stream_indexes,
                      function(d) { return d.domain.lat[0]; }),
      max_lat: d3.max(stream_indexes,
                      function(d) { return d.domain.lat[1]; }),
      min_lng: d3.min(stream_indexes,
                      function(d) { return d.domain.lng[0]; }),
      max_lng: d3.max(stream_indexes,
                      function(d) { return d.domain.lng[1]; }),
      min_alt: d3.min(stream_indexes,
                      function(d) { return d.domain.alt[0]; }),
      max_alt: d3.max(stream_indexes,
                      function(d) { return d.domain.alt[1]; }),
    };

    this.scale_z = d3.scale.linear().domain([extents.min_alt,
                                             extents.max_alt]);
    this.generate_proximity_streams(40);
  };

  StreamSet.prototype.activities = function() {
    return this.activities_;
  };

  StreamSet.prototype.withGeoData = function(callback) {
    return this.activities_.map(function(activity, activity_index) {
      var coordinates = activity.stream.geojson.geometry.coordinates;
      return coordinates.map(function(coordinates, coord_index) {
        return callback.call(this,
                             coordinates[1], // lat
                             coordinates[0], // lng
                             coordinates[2], // alt
                             activity_index,
                             coord_index);
      });
    });
  };

  /**
   * A lazy deep dictionary. Pass keys as arguments, and dicts will be
   * created lazily along the way.
   *
   * Usage:
   * DeepBucket(bucket, x1,y1,z1).foo = 'bar';
   * DeepBucket(bucket, x2,y2,z2).name = 'baz'
   *
   * Now bucket[x1][y1][z1].foo == 'bar'
   */
  DB = DeepBucket;
  function DeepBucket(bucket) {
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

  // adds a 'proximity' stream to each activity
  // A proximity stream is
  StreamSet.prototype.generate_proximity_streams = function(n) {
    // first index the 3d space
    var bucket_lng = d3.scale.linear().domain([this.extents_.min_lng,
                                               this.extents_.max_lng])
          .rangeRound([0,n]).clamp(true);
    var bucket_lat = d3.scale.linear().domain([this.extents_.min_lat,
                                               this.extents_.max_lat])
          .rangeRound([0,n]).clamp(true);
    var bucket_z = this.scale_z.copy().rangeRound([0, n]).clamp(true);

    this.bucket_lng = bucket_lng;
    this.bucket_lat = bucket_lat;
    this.bucket_z = bucket_z;

    // Build up a bucket that effectively maps
    // [lng, lat, z] -> [[activity_index1, [point_index1_1, point_index_1_2,..],
    //                   [activity_index2, [point_index2_1, point_index_2_2,..],
    //                   ...]

    var bucketCount = {};
    function inc(lat, lng, alt, activity_index, coord_index) {
      var blng = bucket_lng(lng);
      var blat = bucket_lat(lat);
      var bz = bucket_z(alt);
      var bucket = DeepBucket(bucketCount, blng, blat, bz,
                              activity_index, coord_index);
      bucket.coord = [lng, lat, alt];
    }
    function val(lat, lng, alt) {
      lng = bucket_lng(lng);
      lat = bucket_lat(lat);
      var z = bucket_z(alt);
      return Object.keys(DeepBucket(bucketCount, lng, lat, z)).length;
    }
    // this is kind of a map-reduce style index: count up all
    // lat/lng/altitude combos, then redistribute the counts out to
    // each stream.

    // Accumulate counts (map)
    this.withGeoData(inc);
    this.bucketCount = bucketCount;

    // Now summarize (reduce)
    var proximities = this.withGeoData(val);
    // now reintegrate them into the existing activities
    _.zip(this.activities_, proximities).forEach(function(actprox) {
      var activity = actprox[0];
      var proximity = actprox[1];
      activity.stream.proximity = { data: proximity };
    });


    // we keep a max so that the proximity shapes have a size range;
    this.maxProximity_ = _(proximities).flatten().max();

    // we're throwing bucketCount away at this point, but could there
    // be value in colorizing the space? i.e. visualizing a cloud in
    // each bucket
    this.bucketCount_ = bucketCount;
  };

  function accessor(attr) {
    return function(d, i) {
      return d[attr];
    };
  }

  // generate metadata about all the streams
  function index_streams(activities) {
    return Promise.all(activities.map(index_stream));
  }

  // generate metadata about a single stream. Returns a promise of the data
  function index_stream(activity) {
    var stream = activity.stream;
    if (!stream) {
      return Promise.reject(["Missing stream in ", activity]);
    }
    return new Promise(function(resolve, reject) {
      var metadata = {domain: {}};

      metadata.geojson = stream.geojson;
      var latlng_stream = stream.latlng;
      var alt_stream = stream.altitude;
      if (latlng_stream && latlng_stream.data) {
        metadata.domain.lat = d3.extent(latlng_stream.data, accessor(0));
        metadata.domain.lng = d3.extent(latlng_stream.data, accessor(1));
      }
      if (alt_stream && alt_stream.data) {
        metadata.domain.alt = d3.extent(alt_stream.data);
      }
      resolve(metadata);
    });
  }

  function CoordinatesCenter(coordinates) {
    return d3.geo.centroid({
      type: 'MultiPoint',
      coordinates: coordinates});
  }

  // Given a sparse array constructed with objects, flatten out all the
  // levels, given array values along the way, returning a list of pairs
  // where the first coordinate is the indexes in the sparse array, and
  // the value is the value at that entry.
  //
  // For example, it transforms this:
  //
  // { 1:
  //   { 2:
  //     { 3: "onetwothree",
  //       4: "onetwofour",
  //     },
  //     8: {
  //         9: "oneeightnine",
  //     }
  //   }
  // }
  //
  // Into this:
  // [
  //   [[1,2,3], "onetwothree"]
  //   [[1,2,4], "onetwofour"]
  //   [[1,8,9], "oneeightnine"]
  // ]
  function ExtractSparseArray(obj, depth) {
    if (depth == 1) {
      return _.pairs(obj).map(function(pair) {
        // we have to return the first element as an array to let
        // concatentation of pair[0] (below) work.
        return [[pair[0]], pair[1]];
      });
    }
    var result = [];
    _.pairs(obj).forEach(function(pairs) {
      // we have to start the key as an array so it can be concatenated.
      var key = [pairs[0]];
      ExtractSparseArray(pairs[1], depth-1).forEach(function(pairs) {
        result.push([key.concat(pairs[0]),
                     pairs[1]]);
      });
    });
    return result;
  }

  // Center of all points in the bucket. Note that this is leaving out
  // altitude!
  function BucketCenter(bucketInfo) {
      var coordinates = _(bucketInfo)
            .map(_.values)
            .flatten(true)
            .pluck('coord')
            .value();
    return CoordinatesCenter(coordinates);
  }

  StreamSet.prototype.allCoordinates = function() {
    var coordinates = _(this.activities()).pluck('stream')
          .pluck('geojson')
          .pluck('geometry')
          .pluck('coordinates')
          .value();
    coordinates = _.reduceRight(coordinates,
                                function(a,b) { return a.concat(b); }, []);

    return coordinates;
  };

  /**
   * Gets the centroid of each bucket that have paths through it.
   */
  StreamSet.prototype.allBucketCoordinates = function() {
    var buckets_by_bucketindex = ExtractSparseArray(this.bucketCount, 3);
    var bucket_averages = _(buckets_by_bucketindex)
          .map(function(pair) {
            var bucketInfo = pair[1];
            return BucketCenter(bucketInfo);
          })
          .unique(false, function(center) {
            return center.join('\n');
          })
          .value();

    return bucket_averages;
  };

  /**
   * Get a simplified set of streams, from bucket center to bucket
   * center.
   */
  StreamSet.prototype.allBucketStreams = function() {
    // This will be a map from activity_index to the array of buckets.
    var buckets_by_bucketindex = ExtractSparseArray(this.bucketCount, 3);

    var activity_coords = {};
    // extract a list of activity_indexes
    _(buckets_by_bucketindex)
      // extract bucket
      .map(function(pair) {
        return pair[1];
      })
      // extract activity_indexes
      .map(function(bucket) {
        return Object.keys(bucket);
      })
      // uniquify across all buckets
      .flatten()
      .unique()

      // Now initialize
      .forEach(function(activity_index) {
        activity_coords[activity_index] = [];
      })
      .value();

    // now reconstruct streams from buckets
    buckets_by_bucketindex
      .forEach(function(pair) {
        var bucketInfo = pair[1];
        var bucket_center = BucketCenter(bucketInfo);
        _(bucketInfo).forEach(function(points, activity_index) {
          // the sort is the challenge here. We're pushing them in
          // bucket order. So instead, we'll put the activity's stream
          // order into the array, and sort it it later.
          _(points).keys().forEach(function(stream_entry_index) {
            activity_coords[activity_index].push(
              [parseInt(stream_entry_index), bucket_center]);
          }).value();
        }).value();
      });

    var bucket_streams = _(activity_coords)
          .pairs()
          .map(function(activity_streams) {
            var activity_index = activity_streams[0];
            var points = activity_streams[1];
            points.sort(function(a, b) {
              return a[0] - b[0];
            });
            var unique = _(points)
                  .map(function(streampoint) {
                    return streampoint[1];
                  })
                  .unique(true, function(point) {
                    return point.join('\n');
                  })
                  .value();
            return unique;
          })
          .value();

    return bucket_streams;
  };



  return StreamSet;
})();

StreamSetView = (function() {
  function StreamSetView(streamset, width, height) {
    this.streamset = streamset;
    this.width = width;
    this.height = height;
    this.scale_z = streamset.scale_z.copy()
      .range([100, 200]); // lower number = darker = lower altitude
    this.projection = get_best_projection(width, height, streamset.features);
  }

  /**
   * Given a set of geojson features, and a height/width to project
   * into, get the best geo projection.
   */
  function get_best_projection(width, height, features) {
    //var center = d3.geo.centroid(features);
    var scale = 1;            // strawman
    var offset = [0,0];

    var projection = d3.geo.albers()
          .scale(scale)
          .translate(offset);

    var path = d3.geo.path().projection(projection);
    var bounds = path.bounds(features);

    // readjust scale and offset, now that we know where 1 and [0,0]
    // takes us.
    scale = .95/Math.max((bounds[1][0] - bounds[0][0]) / width,
                         (bounds[1][1] - bounds[0][1]) / height);
    offset = [(width - scale*(bounds[1][0] + bounds[0][0]))/2,
              (height - scale*(bounds[1][1] + bounds[0][1]))/2];

    // now create a new projection
    projection
      .scale(scale)
      .translate(offset);
    return projection;
  }

  StreamSetView.prototype.allCoordinates = function() {
    return this.streamset.allCoordinates().map(this.projection);
  };

  StreamSetView.prototype.allBucketCoordinates = function() {
    return this.streamset.allBucketCoordinates().map(this.projection);
  };

  StreamSetView.prototype.allBucketStreams = function() {
    return this.streamset.allBucketStreams().map(function(stream) {
      return stream.map(this.projection);
    }, this);
  };

  return StreamSetView;
})();