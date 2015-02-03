// an object that represents the bounds of a map
// note that there is no projection here

// requires d3.js and lodash

function Bounds(activities, xhrContext) {
    this.xhr_ = xhrContext;
    this.activities_ = activities;
    this.ready_ =
        this.load_streams(activities)
        .then(index_streams)
        .then(this.consume_index.bind(this));
    this.ready_.catch(function(ex) {
        console.error("Error loading and indexing: ", ex);
    });
}

// Get a stream and attach it to the activity. Returns a promise that
// resolves to a copy of the activity, and a 'stream' property with
// stream data.
Bounds.prototype.load_stream = function(activity) {
    var activity_id = activity.activity_id;
    if (activity.stream)
        return Promise.resolve(activity);
    return XHR('/api/streams?activity_id=' + activity_id)
        .then(function(streams) {
            var stream = streams.result.streams[activity_id];
            activity.stream = stream;
            return activity;
        });
}

// Returns a promise that resolves the an array of all activities
Bounds.prototype.load_streams = function(activities) {
    var results = [];
    for (var i = 0; i < activities.length; ++i) {
        results.push(this.load_stream(activities[i]));
    }
    return Promise.all(results)
        .then(function(e) {
            console.log("Streams loaded ");
            return e;
        });
}


Bounds.prototype.ready = function() {
    return this.ready_;
}

// xxx need a better name
Bounds.prototype.consume_index = function(stream_index) {
    var extents = this.extents_ = {
        min_lat: d3.min(stream_index, function(d) { return d.domain.lat[0]; }),
        max_lat: d3.max(stream_index, function(d) { return d.domain.lat[1]; }),
        min_lng: d3.min(stream_index, function(d) { return d.domain.lng[0]; }),
        max_lng: d3.max(stream_index, function(d) { return d.domain.lng[1]; }),
        min_alt: d3.min(stream_index, function(d) { return d.domain.alt[0]; }),
        max_alt: d3.max(stream_index, function(d) { return d.domain.alt[1]; }),
    };

    var padding_x = (extents.max_lng - extents.min_lng) * 0.1;
    var padding_y = (extents.max_lat - extents.min_lat) * 0.1;
    this.x = extents.max_lng - padding_x;
    this.y = extents.min_lat - padding_y;
    this.width = extents.min_lng - extents.max_lng + 2*padding_x;
    this.height = extents.max_lat - extents.min_lat + 2*padding_y;

    // todo: use a projection to make sure the x/y are scaled
    // appropriately. For demonstration purposes, a 1:1 projection
    // looks fine at my latitude.

    this.scale_x = d3.scale.linear().domain([this.x, this.x+this.width]);
    console.log("scale_x = ", this.scale_x);
    this.scale_y = d3.scale.linear().domain([this.y+this.height, this.y]);
    this.scale_z = d3.scale.linear().domain([extents.min_alt,
                                             extents.max_alt]);

    this.generate_proximity_streams(20);
};

Bounds.prototype.withGeoData = function(callback) {
    return this.activities_.map(function(activity, i) {
        var zipped = _.zip(activity.stream.latlng.data,
                           activity.stream.altitude.data);
        return zipped.map(function(streamdata) {
            // streamdata is [latlng, altitude]
            return callback.call(this, streamdata[0][0], streamdata[0][1], streamdata[1], i);
        });
    });
};

// adds a 'proximity' stream to each activity
// A proximity stream is
Bounds.prototype.generate_proximity_streams = function(n) {
    // first index the 3d space
    var bucket_x = this.scale_x.copy().rangeRound([0, n]).clamp(true);
    var bucket_y = this.scale_y.copy().rangeRound([0, n]).clamp(true);
    var bucket_z = this.scale_z.copy().rangeRound([0, n]).clamp(true);

    var bucketCount = {};
    function inc(lat, lng,alt,id) {
        var x = bucket_x(lng);
        var y = bucket_y(lat);
        var z = bucket_z(alt);
        if (!(x in bucketCount))
            bucketCount[x] = {};
        if (!(y in bucketCount[x]))
            bucketCount[x][y] = {};
        if (!(z in bucketCount[x][y]))
            bucketCount[x][y][z] = d3.set();
        bucketCount[x][y][z].add(id);
    }
    function val(lat, lng, alt) {
        var x = bucket_x(lng);
        var y = bucket_y(lat);
        var z = bucket_z(alt);
        return bucketCount[x][y][z].size();
    }
    // this is kind of a map-reduce style index: count up all
    // lat/lng/altitude combos, then redistribute the counts out to
    // each stream.
    this.withGeoData(inc);

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

Bounds.prototype.setSize = function(width, height) {
    var minSize = Math.min(width, height);
    this.scale_x.range([0, minSize]);
    this.scale_y.range([0, minSize]);
    this.scale_z.range([100, 200]); // lower number = darker = lower altitude
};

Bounds.prototype.center = function() {
    var lng_delta = this.scale_x.domain()[1] - this.scale_x.domain()[0];
    var lng_center = this.scale_x.domain()[0] + lng_delta/2;

    var lat_delta = this.scale_y.domain()[1] - this.scale_x.domain()[0];
    var lat_center = this.scale_y.domain()[0] + lat_delta/2;

    return [lat_center, lng_center];
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
