// an object that represents the bounds of a map
// note that there is no projection here

// requires d3.js and lodash

function Bounds(activities, xhrContext, resolution) {
    this.xhr_ = xhrContext;
    this.activities_ = activities;
    this.resolution = resolution;
}

// Get a stream and attach it to the activity. Returns a promise that
// resolves to a copy of the activity, and a 'stream' property with
// stream data.
Bounds.prototype.load_stream = function(activity) {
    var activity_id = activity.activity_id;
    if (activity.stream)
        return Promise.resolve(activity);
    return this.xhr_('/api/streams', {activity_id: activity_id,
                                      resolution: this.resolution })
        .then(function(streams) {
            var stream = streams.result.streams[activity_id];
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
            //console.log("Making geojson: ", stream.geojson);

            activity.stream = stream;
            return activity;
        });
};


// Returns a promise that resolves the an array of all activities
Bounds.prototype.load_streams = function(activities) {
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


Bounds.prototype.ready = function() {
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
Bounds.prototype.consume_index = function(stream_indexes) {

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
    this.generate_proximity_streams(20);
};

Bounds.prototype.activities = function() {
    return this.activities_;
};

Bounds.prototype.withGeoData = function(callback) {
    return this.activities_.map(function(activity, i) {
        var coordinates = activity.stream.geojson.geometry.coordinates;
        return coordinates.map(function(coordinates) {
            return callback.call(this,
                                 coordinates[1], // lat
                                 coordinates[0], // lng
                                 coordinates[2], // alt
                                 i);
         });
    });
};

// adds a 'proximity' stream to each activity
// A proximity stream is
Bounds.prototype.generate_proximity_streams = function(n) {
    // first index the 3d space
    var bucket_lng = d3.scale.linear().domain([this.extents_.min_lng,
                                               this.extents_.max_lng])
            .rangeRound([0,n]).clamp(true);
    var bucket_lat = d3.scale.linear().domain([this.extents_.min_lng,
                                               this.extents_.max_lng])
            .rangeRound([0,n]).clamp(true);
    var bucket_z = this.scale_z.copy().rangeRound([0, n]).clamp(true);

    var bucketCount = {};
    function inc(lat, lng, alt, id) {
        lng = bucket_lng(lng);
        lat = bucket_lat(lat);
        var z = bucket_z(alt);
        if (!(lng in bucketCount))
            bucketCount[lng] = {};
        if (!(lat in bucketCount[lng]))
            bucketCount[lng][lat] = {};
        if (!(z in bucketCount[lng][lat]))
            bucketCount[lng][lat][z] = d3.set();
        bucketCount[lng][lat][z].add(id);
    }
    function val(lat, lng, alt) {
        lng = bucket_lng(lng);
        lat = bucket_lat(lat);
        var z = bucket_z(alt);
        return bucketCount[lng][lat][z].size();
    }
    // this is kind of a map-reduce style index: count up all
    // lat/lng/altitude combos, then redistribute the counts out to
    // each stream.

    // Accumulate counts (map)
    this.withGeoData(inc);

    // Now summarize (reduce)
    var proximities = this.withGeoData(val);
    console.log("Made proximities: ", proximities);
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

Bounds.prototype.setSize = function(width, height) {
    this.scale_z.range([100, 200]); // lower number = darker = lower altitude
    this.projection = get_best_projection(width, height, this.features);
};

function accessor(attr) {
    return function(d, i) {
        return d[attr];
    };
}

// generate metadata about all the streams
function index_streams(activities) {
    var results = [];
    for (var i = 0; i < activities.length; ++i) {
        results.push(index_stream(activities[i]));
    }
    return Promise.all(results);
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
