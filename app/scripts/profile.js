
// Get a stream and attach it to the activity.
function get_stream(activity) {
    var activity_id = activity.activity_id;
    return XHR('/api/streams?activity_id=' + activity_id)
        .then(function(streams) {
            var stream = streams.result.streams[activity_id];
            activity.stream = stream;
            return stream;
        });
}

// generate metadata about all the streams
function index_streams(activities) {
    return new Promise(function(resolve, reject) {
        var results = [];
        for (var i = 0; i < activities.length; ++i) {
            if (!activities[i].stream)
                results.push(get_stream(activities[i]).then(index_stream));
            else
                results.push(index_stream(activities[i].stream));
        }
        Promise.all(results).then(function(stream_indexes) {
            console.log("All streams ready! ", stream_indexes);
            resolve(stream_indexes);
        }).catch(function(ex) {
            console.error("oops, rejected: ", ex);
        });
    });
}

// generate metadata about a single stream
function index_stream(stream) {
    if (!stream) {
        return Promise.reject("Missing stream");
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

function accessor(attr) {
    return function(d, i) {
        return d[attr];
    };
}

// an object that represents the bounds of a map
// note that there is no projection here
function Bounds(activities) {
    this.activities_ = activities;

    this.ready_ = index_streams(activities)
        .then(this.consume_index.bind(this));
}

Bounds.prototype.ready = function() {
    return this.ready_;
}

// xxx need a better name
Bounds.prototype.consume_index = function(stream_index) {
    var extents = {
        min_lat: d3.min(stream_index, function(d) { return d.domain.lat[0]; }),
        max_lat: d3.max(stream_index, function(d) { return d.domain.lat[1]; }),
        min_lng: d3.min(stream_index, function(d) { return d.domain.lng[0]; }),
        max_lng: d3.max(stream_index, function(d) { return d.domain.lng[1]; }),
        min_alt: d3.min(stream_index, function(d) { return d.domain.alt[0]; }),
        max_alt: d3.max(stream_index, function(d) { return d.domain.alt[1]; }),
    };
    console.log("Now have extents = ", extents);

    var padding_x = (extents.max_lng - extents.min_lng) * 0.1;
    var padding_y = (extents.max_lat - extents.min_lat) * 0.1;
    this.x = extents.min_lng - padding_x;
    this.y = extents.min_lat - padding_y;
    this.width = extents.max_lng - extents.min_lng + 2*padding_x;
    this.height = extents.max_lat - extents.min_lat + 2*padding_y;

    // todo: use a projection to make sure the x/y are scaled
    // appropriately. For demonstration purposes, a 1:1 projection
    // looks fine at my latitude.

    this.scale_x = d3.scale.linear().domain([this.x, this.x+this.width]);
    this.scale_y = d3.scale.linear().domain([this.y+this.height, this.y]);
    this.scale_z = d3.scale.linear().domain([extents.min_alt,
                                             extents.max_alt]);
}

Bounds.prototype.setSize = function(width, height) {
    if (width > height) {
        this.scale_x.range([0, height]);
        this.scale_y.range([0, height]);
    } else {
        this.scale_x.range([0, width]);
        this.scale_y.range([0, width]);
    }
    this.scale_z.range([100, 200]); // lower number = darker = lower altitude
};

Bounds.prototype.center = function() {
    var lng_delta = this.scale_x.domain()[1] - this.scale_x.domain()[0];
    var lng_center = this.scale_x.domain()[0] + lng_delta/2;

    var lat_delta = this.scale_y.domain()[1] - this.scale_x.domain()[0];
    var lat_center = this.scale_y.domain()[0] + lat_delta/2;

    return [lat_center, lng_center];
}

function drawmap(activities) {
    var bounds = new Bounds(activities);

    bounds.ready().then(function() {
        draw2d(bounds, activities);
        draw3d(bounds, activities);
    });
}

function Dataset() {
    this._pending_activities =
        XHR('/api/activities').then(function(response) {
            console.log("Got activities: ", response);
            return response.result.activities;
        });
}

Dataset.prototype.activities = function() {
    return this._pending_activities.then(function(activities) {
        var r = run_filter(activities);
        console.log("Filtered to ", r.length, " activities");
        return r;
    });
};

function draw3d(bounds, activities) {
    var canvas = document.querySelector('#map-3d');

    bounds.setSize(canvas.width, canvas.height);
    var color = d3.scale.ordinal().range(colorbrewer.Set3[12]);

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera( 75, canvas.width / canvas.height, 0.1, 1000 );
    var controls = new THREE.OrbitControls(camera, canvas);

    var renderer = new THREE.WebGLRenderer({
        canvas: canvas
    });

    var max_z = -1;
    var min_z = -1;
    activities.forEach(function(activity, index) {
        //console.log("drawing activity ", index, ": ", activity);
        var geometry = new THREE.Geometry();
        for (var i = 0; i < activity.stream.altitude.data.length; ++i) {
            var point = activity.stream.latlng.data[i];
            var altitude = activity.stream.altitude.data[i];

            var x = Math.round(bounds.scale_x(point[1]));
            var y = Math.round(bounds.scale_y(point[0]));
            var z = Math.round(bounds.scale_z(altitude));

            geometry.vertices.push(new THREE.Vector3(x, y, z));
        }
        var material = new THREE.LineBasicMaterial({
            color: color(index),
            linewidth: 2
        });

        geometry.computeBoundingBox();
        console.log("  Bounding box:", geometry.boundingBox);
        var line = new THREE.Line(geometry, material);
        scene.add(line);
    });

    var min = {};
    var max = {};
    var center = {};
    ['x', 'y', 'z'].forEach(function(axis) {
        max[axis] = d3.max(scene.children, function(child) {
            return child.geometry.boundingBox.max[axis];
        });
        min[axis] = d3.min(scene.children, function(child) {
            return child.geometry.boundingBox.min[axis];
        });
        center[axis] = (max[axis] - min[axis])/2;
    });

    var vShader = document.querySelector('#vertexShader').innerText;
    var fShader = document.querySelector('#fragmentShader').innerText;
    var shaderMaterial =
            new THREE.ShaderMaterial({
                vertexShader:   vShader,
                fragmentShader: fShader
            });

    // backing plane for visual reference
    var planeGeometry = new THREE.PlaneGeometry( canvas.width, canvas.height );
    var planeMaterial = new THREE.MeshBasicMaterial( {color: 0xaaaaaa, side: THREE.DoubleSide} );
    var plane = new THREE.Mesh( planeGeometry, shaderMaterial );
    plane.position.x = canvas.width / 2;
    plane.position.y = canvas.height / 2;
    scene.add(plane);

    REFPLANE = plane;
    CAMERA = camera;
    SCENE = scene;

    var x_center = (max.x-min.x)/2;
    var y_center = (max.y-min.y)/2;
    var z_center = (max.z-min.z)/2;
    camera.position.set(0, 0, max.z);
    controls.target.set(center.x, center.y, 0);
    //camera.lookAt(center.x, center.y, center.z);

    function render() {
	    requestAnimationFrame(render);
        controls.update();
	    renderer.render(scene, camera);
    }
    console.log("Kicking off render with ", scene, camera);
    render();



}

function draw2d(bounds, activities) {
    var canvas = document.querySelector('#map');

    bounds.setSize(canvas.width, canvas.height);

    var center = bounds.center();

    var projection = d3.geo.transverseMercator()
            .translate(canvas.width / 2, canvas.height/2)
            .scale(canvas.width * 100) // ???
            .rotate(center)           // supposed to be the central meridian?
            .center(center);

    var color = d3.scale.ordinal().range(colorbrewer.Set3[12]);
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0,0,canvas.width, canvas.height);

    // draw altitude gradients first - this is terribly inefficient
    var gradientRadius = canvas.width * 0.02;
    var gradientCache = {};
    for (var i = 0; i < activities.length; ++i) {
        if (!activities[i].stream)
            continue;
        for (var j = 0; j < activities[i].stream.altitude.data.length; ++j) {
            var point = activities[i].stream.latlng.data[j];
            var altitude = activities[i].stream.altitude.data[j];
            var x = Math.round(bounds.scale_x(point[1]));
            var y = Math.round(bounds.scale_y(point[0]));
            var z = Math.round(bounds.scale_z(altitude));
            var zcolor = z + ',' + z + ',' + z;

            var gradient = gradientCache[x + "," + y + "," + z];
            if (gradient) continue;
            if (!gradient) {
                //console.log("creating gradient for ", x, y);
                gradient = ctx.createRadialGradient(x,y,1,x,y,gradientRadius);
                gradient.addColorStop(0, 'rgba(' + zcolor + ',.90)');
                gradient.addColorStop(1, 'rgba(' + zcolor + ',0)');
                gradientCache[x + "," + y + ',' + z] = gradient;
            }
            ctx.fillStyle = gradient;
            ctx.fillRect(x-gradientRadius,y-gradientRadius,x+gradientRadius,y+gradientRadius);
        }
    }

    for (var i = 0; i < activities.length; ++i) {
        if (!activities[i].stream)
            continue;
        ctx.strokeStyle = color(i);
        ctx.beginPath();
        var stream = activities[i].stream.latlng;
        var last_point = stream.data[0];
        ctx.moveTo(bounds.scale_x(last_point[1]),
                   bounds.scale_y(last_point[0]));
        console.log("Drawing ", stream.data.length, " points");
        for (var j = 1; j < stream.data.length; ++j) {
            var point = stream.data[j];
            ctx.lineTo(bounds.scale_x(point[1]),
                       bounds.scale_y(point[0]));
        }
        ctx.stroke();
    }
}

// creates a filter from the UI controls, where the filter is in the form
// [[key, value], [key, value]]
function make_filters() {
    var test_value = [];
    var test_facet = [];

    // generate filter
    var controls = document.querySelectorAll('.map-control');
    for (var i = 0; i < controls.length; ++i) {
        var properties = JSON.parse(controls[i].getAttribute('properties'));
        var criteria = controls[i].querySelectorAll('span.tab');
        for (var j = 0; j < criteria.length; j++) {
            var criterium = criteria[j];
            if (criterium.classList.contains('polymer-selected')) {
                var value = criterium.getAttribute('value');
                var facet_id = criterium.getAttribute('facet');
                var facet = FACETS_BY_ID[facet_id];
                if (value != '*') {
                    console.log("Trying to extract using ", facet.key, " and ", value);
                    // note that the facets contain the already-extracted values
                    value = JSON.parse(value);
                    console.log("And value has become ", value);
                    test_value.push(value);
                    test_facet.push(facet);
                    console.log("I need to check for ", properties, ' = ', value, ' using ', facet);
                }
            }
        }
    }

    return [test_value, test_facet];
}

function run_filter(activities) {
    var filter_params = make_filters();
    var match_value = filter_params[0];
    var facets = filter_params[1];
    var result = [];
    for (var i = 0; i < activities.length; ++i) {
        var matches = true;
        var activity = activities[i];
        console.log("Processing filters: ", filter_params);
        for (var j = 0; j < facets.length; j++) {
            var facet = facets[j];
            var value = facet.extract(facet.key, activity);
            if (!facet.matches(match_value[j], value)) {
                matches = false;
                break;
            }
        }
        if (matches)
            result.push(activity);
    }
    return result;
}

// activities is just the regular activities list
// properies is an array of arrays of properties:
// [['type'], ['gear_id']]
function create_facet_ui(activities, properties_list) {
    // count of propvals[proname][value] == count, like
    // propval['type']['Ride'] == 12
    var propvals = {};
    for (var i = 0; i < properties_list.length; ++i) {
        var properties = properties_list[i];

        for (var k = 0; k < activities.length; ++k) {
            var activity = activities[k];
            var propkey = [];
            var propval = [];
            for (var j = 0; j < properties.length; j++) {
                var property = properties[j];

                var value = activity[property];
                propkey.push(property);
                propval.push(value);
            }

            propkey = propkey.join(',');
            propval = propval.join(',');
            if (!(propkey in propvals))
                propvals[propkey] = {};
            if (!(propval in propvals[propkey]))
                propvals[propkey][propval] = 0;
            ++propvals[propkey][propval];
        }
    }
    console.log("Generated ", propvals);

    var control_div = document.querySelector('.map-ui');
    var labels = [];
    for (i = 0; i < properties_list.length; ++i) {
        properties = properties_list[i];
        propkey = properties.join(',');
        var container = document.createElement('div');
        container.className = "map-control";
        control_div.appendChild(container);

        // technically this should be properties.join(','), but we're
        // only using the first value because the label is probably
        // prettier.
        var label = properties[0] + ": ";
        container.appendChild(document.createTextNode(label));
        var tabStrip = document.createElement('polymer-ui-tabs');
        tabStrip.properties = properties;
        tabStrip.propkey = propkey;

        function add(propval) {
            var span = document.createElement('span');
            var text = propval;
            if (propval == '*')
                text += " (" + sum(Object.keys(propvals[propkey])
                                   .map(function(k) { return propvals[propkey][k]; }))
                + ")";
            else
                text += " (" + propvals[propkey][propval] + ")";
            span.innerText = text;
            span.propval = propval;
            tabStrip.appendChild(span);
        }

        add('*');
        // just use the first property for now?
        for (var propval in propvals[propkey]) {
            add(propval);
        }

        container.appendChild(tabStrip);
    }

}

function sum(values) {
    return values.reduceRight(function(previous, current) { return previous+current; });
}

// Create an XHR context that fires off progress notifications
// usage:
// function update_progress(waiting, total) {
//   console.log("Updated ", waiting, " / ", total);
// }
// var XHR = xhrContext(update_progress);
// XHR('http://....).then(function(result)) {... });
function xhrContext(progress) {
    var total_started = 0;
    var total_complete = 0;

    function update_progress() {
        progress(total_started, total_complete);
        if (total_started == total_complete)
            total_started = total_complete = 0;
    }

    return function(url) {
        total_started += 1;
        progress(total_started, total_complete);
        return new Promise(function(resolve, reject) {
            try {
                var xhr = new XMLHttpRequest();
                LASTXHR = xhr;
                xhr.open('GET', url, true);
                xhr.onload = function() {
                    // console.error("Got response from ", url, ": ", xhr.responseText);
                    try {
                        var response = JSON.parse(xhr.responseText);
                        resolve(response);
                    } catch(ex) {
                        console.trace(ex, " in ", xhr.responseText);
                        reject(ex);
                    }
                    total_complete += 1;
                    update_progress();
                };
                xhr.onerror = function(e) {
                    total_complete += 1;
                    update_progress();
                    reject(e);
                };
                console.log("Requesting ", url);
                xhr.send();
            } catch (ex) {
                total_complete +=1;
                update_progress();
                reject(ex);
            };
        });
    };
}

function refresh() {
    console.log("refreshing..");
    return D.activities().then(drawmap).catch(function(ex) { console.error(ex); });
}

// given a keylist like ['foo', 'bar'] extracts the corresponding
// objects from obj, i.e. returns [obj.foo, obj.bar]
function extract_key_list_value(key_list, obj) {
    var key_value = [];
    key_list.forEach(function(subkey) {
        key_value.push(obj[subkey]);
    });
    return key_value;
}

function extract_key_value(key, obj) {
    return obj[key];
}

function equals(a, b) {
    return a == b;
}

function equals_lists(a, b) {
    if (a.length != b.length)
        return false;
    for (var i = 0; i < a.length; ++i)
        if (a[i] != b[i])
            return false;
    return true;
}

function equals_day_of_week(a, b) {
    console.log("Comparing ", a, " and ", b, ": ", a == b);
    return a == b;
}

var DAYS = [ "Sun", "Mon", "Tue", "Wed", "Thurs", "Fri", "Sat"];
function extract_day_of_week(key, obj) {
    var value = extract_key_value(key, obj);
    var day = new Date(value).getDay();
    return DAYS[day];
}

function display_city(values, count) {
    return values[0] + " (" + count + ")";
}

function display_value(value, count) {
    return value + " (" + count + ")";
}

FACETS = [
    { name: 'Location',
      id: 'location',
      key: ['location_city', 'location_state', 'location_country'],
      extract: extract_key_list_value,
      matches: equals_lists,
      display: display_city,
    },
    { name: 'Type',
      id: 'type',
      key: 'type',
      extract: extract_key_value,
      matches: equals,
      display: display_value,
    },
    { name: 'Day of Week',
      id: 'day_of_week',
      key: 'start_date',
      extract: extract_day_of_week,
      matches: equals_day_of_week,
      display: display_value,
    }
];

FACETS_BY_ID = {};
FACETS.forEach(function(facet) {
    FACETS_BY_ID[facet.id] = facet;
});

function update_progress_indicator(waiting, complete) {
    if (waiting == complete)
        $('#progress').hide();
    else
        $('#progress').show().text(complete*100/waiting + "%");
}

function init() {
    XHR = xhrContext(update_progress_indicator);

    D = new Dataset();
    D.activities().then(function(activities) {
        FACETS.forEach(function(facet) {
            var key_counts = {};
            var key_string = JSON.stringify(facet.key);
            // extract all possible key values
            activities.forEach(function(activity) {
                var key_value = facet.extract(facet.key, activity);
                var key = JSON.stringify(key_value);
                if (!(key in key_counts))
                    key_counts[key] = 0;
                key_counts[key] += 1;
            });

            console.log("Extracted: ", Object.keys(key_counts));

            // now build up the facet UI
            // (Note this will get way more complex in a bit)
            Object.keys(key_counts).forEach(function(key) {
                var count = key_counts[key];
                var sp = $('<span>')
                        .addClass('tab')
                        .attr('value', key)
                        .attr('facet', facet.id)
                        .text(facet.display(JSON.parse(key), count));
                $('.facet-' + facet.id).append(sp);
            });
        });
        // extract all visible keys
    });

    var controls = document.querySelectorAll('.map-control polymer-ui-tabs');
    for (var i = 0; i < controls.length; ++i) {
        if (!controls[i].hasEventListener) {
            controls[i].addEventListener('polymer-activate', refresh);
            controls[i].hasEventListener = true;
        }
    }

    refresh();
}

// hack hack
document.addEventListener('WebComponentsReady', init);
console.log("profile.js loaded, should be calling other stuff");