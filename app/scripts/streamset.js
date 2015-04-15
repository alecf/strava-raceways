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
    this.scale_x = d3.scale.linear();
    this.scale_y = d3.scale.linear();
    this.scale_z = d3.scale.linear();
  }

  /**
   * Get a stream and attach it to the activity. Returns a promise
   * that resolves to a copy of the activity, and a 'stream' property
   * with stream data.
   */
  StreamSet.prototype.load_stream_ = function(activity) {
    var activity_id = activity.activity_id;
    if (activity.stream)
      return Promise.resolve(activity);
    return this.xhr_('/api/streams', {activity_id: activity_id,
                                      resolution: this.resolution })
      .then(function(streams) {
        var stream = streams.result.streams[activity_id];
        activity.stream = stream;
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
              var altitude = stream.altitude &&
                    stream.altitude.data &&
                    stream.altitude.data[i] || 0;
              return [latlng[1], latlng[0], altitude];
            })
          }
        };
        stream.geojson = geojson;
        return activity;
      });
  };


  /**
   * Returns a promise that resolves the an array of all activities.
   */
  StreamSet.prototype.load_streams_ = function(activities) {
    var results = [];
    for (var i = 0; i < activities.length; ++i) {
      results.push(this.load_stream_(activities[i]));
    }
    return Promise.all(results)
      .then(function(e) {
        console.log("Streams loaded (", results.length, ')');
        return e;
      });
  };

  /**
   * Returns a promise that resolves when this streamset is fully loaded.
   */
  StreamSet.prototype.ready = function() {
    if (!this.ready_) {
      this.ready_ =
        this.load_streams_(this.activities_)
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

  /**
   * Calculates various extents across all the streams.
   */
  StreamSet.prototype.consume_index = function(stream_indexes) {

    this.features = join_geojsons(stream_indexes
                                  .filter(function(metadata) {
                                    return metadata.geojson; })
                                  .map(function(metadata) {
                                    return metadata.geojson;
                                  }));

    var extents = this.extents_ = {
      min_lat: d3.min(stream_indexes, function(d) {
        return d.domain.lat && d.domain.lat[0] || Infinity;
      }),
      max_lat: d3.max(stream_indexes, function(d) {
        return d.domain.lat && d.domain.lat[1] || -Infinity;
      }),
      min_lng: d3.min(stream_indexes, function(d) {
        return d.domain.lng && d.domain.lng[0] || Infinity;
      }),
      max_lng: d3.max(stream_indexes, function(d) {
        return d.domain.lng && d.domain.lng[1] || -Infinity;
      }),
      min_alt: d3.min(stream_indexes, function(d) {
        return d.domain.alt && d.domain.alt[0] || Infinity;
      }),
      max_alt: d3.max(stream_indexes, function(d) {
        return d.domain.alt && d.domain.alt[1] || -Infinity;
      }),
    };

    this.generate_proximity_streams(40);
  };

  /**
   * Direct access to the activites - this should be done with a
   * promise :(
   */
  StreamSet.prototype.activities = function() {
    return this.activities_;
  };

  /**
   * Iterates over geo data with the given callback.
   * The callback should have the signature:
   *    function(lat, lng, altitude, activity_index, coord_index)
   */
  StreamSet.prototype.withGeoData = function(callback) {
    return this.activities_.map(function(activity, activity_index) {
      if (!activity.stream || !activity.stream.geojson) {
        return null;
      }
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
    var bucket_z = this.scale_z.copy().domain([this.extents_.min_alt,
                                               this.extents_.max_alt])
          .rangeRound([0, n]).clamp(true);

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
      var bucket = SparseArray(bucketCount, blng, blat, bz,
                              activity_index, coord_index);
      bucket.coord = [lng, lat, alt];
    }
    function val(lat, lng, alt) {
      lng = bucket_lng(lng);
      lat = bucket_lat(lat);
      var z = bucket_z(alt);
      return Object.keys(SparseArray(bucketCount, lng, lat, z)).length;
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
    // if (!activity.stream) {
    //   return Promise.reject(["Missing stream in ", activity]);
    // }
    return new Promise(function(resolve, reject) {
      var metadata = {domain: {}};

      if (stream) {
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
      }
      resolve(metadata);
    });
  }

  var bucketlog = 3;
  /**
   * Get the center of an array of coordinates of the form [lat, lng, altitude]
   *
   * Returns an array of [lat, lng, altitude, [coordinates...]]
   */
  function CoordinatesCenter(coordinates) {
    var latlng_center = d3.geo.centroid({
      type: 'MultiPoint',
      coordinates: coordinates
    });

    var average_altitude = d3.sum(_.pluck(coordinates, 2)) / coordinates.length;
    var result = [latlng_center[0],
                  latlng_center[1],
                  average_altitude,
                  //coordinates];
                 ];
      if (bucketlog-- > 0) {
          // console.log("BucketCenter of ", coordinates, " is ", result);
      }
      return result;
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
    return CoordinatesCenter(coordinates).concat([bucketInfo]);
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
    // Returns pairs of
    // [[x_index, y_index, z_index], bucketInfo]
    // where bucketInfo is { 0: [coord1, coord2, etc.. ],
    //                       1: [coord1, coord2, etc.. ], ... }
    var buckets_by_bucketindex = ExtractSparseArray(this.bucketCount, 3);
    var bucket_averages = _(buckets_by_bucketindex)
          .map(function(pair) {
            var bucketInfo = pair[1];
            return BucketCenter(bucketInfo);
          })
          .unique(false, function(center) {
            // Unique only by by [lng, lat, alt]
            return center.slice(0,3).join('\n');
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
    // Returns pairs of
    // [[b0, b1, b2], bucketInfo]
    // where bucketInfo is { 0: [coord1, coord2, etc.. ],
    //                       1: [coord1, coord2, etc.. ], ... }
    var buckets_by_bucketindex = ExtractSparseArray(this.bucketCount, 3);

    // First we'll need to fill up activity_coords with a bunch if
    // counters, one for each activity.
    // TODO(alecflett): This is absurd! we just need a slot for 0..activities.length
    var activity_coords = {};

    // extract a list of activity_indexes
    _(buckets_by_bucketindex)
    // extract bucket
      .map(function(pair) {
        // grab just the bucketInfo
        return pair[1];
      })
      // extract activity_indexes
      .map(function(bucketInfo) {
        return Object.keys(bucketInfo);
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
          // order into the array, and re-sort it it later.
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

            // uniquify them across buckets
            var unique = _(points)
                  .map(function(streampoint) {
                    return streampoint[1];
                  })
                  .unique(true, function(point) {
                    return point.slice(0,3).join('\n');
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
    this.scale_x = streamset.scale_x.copy();
    this.scale_y = streamset.scale_y.copy();
    this.scale_z = streamset.scale_z.copy()
      .range([100, 500]); // lower number = darker = lower altitude
    this.projection = get_best_projection(width, height, streamset.features);
  }

  /**
   * Given a set of geojson features, and a height/width to project
   * into, get the best geo projection.
   */
  function get_best_projection(width, height, features) {
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
    var bucketCoordinates = this.streamset.allBucketCoordinates();
    return bucketCoordinates.map(this.projection);
  };

  StreamSetView.prototype.allBucketStreams = function() {
    var scale_x = this.scale_x;
    var scale_y = this.scale_y;
    var scale_z = this.scale_z;
    var projection = this.projection;
    return this.streamset.allBucketStreams().map(function(stream) {
      return stream.map(projection)
        .map(function(bucket, index) {
          return [scale_x(bucket[0]),
                  scale_y(bucket[1]),
                  // copy over altitude and proximity data from
                  // original stream
                  scale_z(stream[index][2]),
                  stream[index][3]];
        }, this);
    }, this);
  };

  /**
   * Get the number of pixels across the x and y dimension.
   *
   * @return [lngppm, latppm].
   */
  StreamSetView.prototype.pixelsPerMeter = function() {
    var lat_distance = d3.geo.distance(
      this.projection.invert([this.width/2, 0]),
      this.projection.invert([this.width/2, this.height])) * 6378000;
    var lng_distance = d3.geo.distance(
      this.projection.invert([0, this.height/2]),
      this.projection.invert([this.width, this.height/2])) * 6378000;

    // take the average across height and width.
    var lat_ratio = this.height / lat_distance;
    var lng_ratio = this.width / lng_distance;
    return [lng_ratio, lat_ratio];
  };

  return StreamSetView;
})();