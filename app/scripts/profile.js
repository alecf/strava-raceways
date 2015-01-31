
function Profile() {}

// Get a stream and attach it to the activity. Returns a promise that
// resolves to a copy of the activity, and a 'stream' property with
// stream data.
function load_stream(activity) {
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
function load_streams(activities) {
    var results = [];
    for (var i = 0; i < activities.length; ++i) {
        results.push(load_stream(activities[i]));
    }
    return Promise.all(results)
        .then(function(e) { console.log("Streams loaded "); return e; });
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

function accessor(attr) {
    return function(d, i) {
        return d[attr];
    };
}

function render3d(render_context) {
    render_context.controls.update();
	render_context.renderer.render(render_context.scene, render_context.camera);
    pending_render = false;
}

var pending_render = false;
function render_loop(render_context) {
    if (!pending_render)
	    requestAnimationFrame(function() {
            render3d(render_context);
        });
    pending_render = true;
}

/**
 * Update the map
 */
function updatemap(render_context, activities) {
    var bounds = new Bounds(activities);
    B = bounds;

    bounds.ready().then(function() {
        updatescene(render_context, bounds, activities);
        render_loop(render_context);
    }).catch(function(ex) { console.error(ex); });
}

/**
 * Setup. Returns a "rendering context" that will need to also be
 * populated with a scene and a camera.
 */
function init3d(profile_page) {
    console.log("Ready with canvas on ", profile_page);
    var canvas = profile_page.$['map-3d'];

    var context = {
        renderer: new THREE.WebGLRenderer({
            canvas: canvas
        }),
        canvas: canvas,
        height: 300,
        width: 400,
    };
    return context;
}

function updatesize(render_context) {
}

function updatescene(render_context, bounds, activities) {

    if (!render_context.camera) {
        render_context.camera =
            new THREE.PerspectiveCamera( 75,
                                         render_context.width / render_context.height, 0.1, 1000 );
        // Create an event listener that resizes the renderer with the browser window.
        window.addEventListener('resize', function() {
            var rect = render_context.canvas.getBoundingClientRect();
            //render_context.renderer.setSize(WIDTH, HEIGHT);
            render_context.camera.aspect = rect.width / rect.height;
            render_context.camera.updateProjectionMatrix();
        });
        render_context.controls = new THREE.OrbitControls(render_context.camera, render_context.canvas);
        render_context.camera.up.set(0,0,1);
        render_context.controls.addEventListener('change', function() {
            // just redraw, don't recreate the scene
            render_loop(render_context);
        });
    }
    bounds.setSize(render_context.canvas.width, render_context.canvas.height);
    var proximityRadius = d3.scale.linear().domain([1, bounds.maxProximity_]);
    proximityRadius.rangeRound([0, 4]);

    var color = d3.scale.ordinal().range(colorbrewer.Set3[12]);

    var max_z = -1;
    var min_z = -1;
    var totalspheres = 0;
    render_context.scene = new THREE.Scene();
    activities.forEach(function(activity, index) {
        var lambertMaterial =
                new THREE.MeshLambertMaterial( {
                    color: color(index),
                    shading: THREE.FlatShading
                } );

        //console.log("drawing activity ", index, ": ", activity);
        var geometry = new THREE.Geometry();
        var spherecount = 0;
        for (var i = 0; i < activity.stream.altitude.data.length; ++i) {
            var point = activity.stream.latlng.data[i];
            var altitude = activity.stream.altitude.data[i];
            var proximity = activity.stream.proximity.data[i];

            var x = bounds.scale_x(point[1]);
            var y = bounds.scale_y(point[0]);
            var z = bounds.scale_z(altitude);

            geometry.vertices.push(new THREE.Vector3(x, y, z));

            // gad this is expensive
            var radius = proximityRadius(proximity);
            if (proximity > 1 &&
                radius >= 1 &&
                totalspheres < 2000 && // ugh artificial
                !(i % 30)) {    //also artificial
                spherecount++;
                var sphere = new THREE.SphereGeometry(radius);
                var sphereMesh = new THREE.Mesh(sphere,
                                                lambertMaterial);

                sphereMesh.position.set(x,y,z);
                render_context.scene.add(sphereMesh);
            }
        }
        //console.log("Activity ", index, " got ", spherecount, " spheres");
        totalspheres += spherecount;
        var material = new THREE.LineBasicMaterial({
            color: color(index),
            linewidth: 2
        });

        geometry.computeBoundingBox();
        var line = new THREE.Line(geometry, material);
        render_context.scene.add(line);
    });

    //console.log("Total of ", totalspheres, " spheres");
    var min = {};
    var max = {};
    var center = {};
    ['x', 'y', 'z'].forEach(function(axis) {
        // super hack - we're using the fact that we haven't computed
        // the bounding boxes for the spheres to filter them out and
        // make this calcuation faster
        max[axis] = d3.max(render_context.scene.children, function(child) {
            if (child.geometry.boundingBox)
                return child.geometry.boundingBox.max[axis];
        });
        min[axis] = d3.min(render_context.scene.children, function(child) {
            if (child.geometry.boundingBox)
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
    var lambertMaterial =
            new THREE.MeshLambertMaterial( { color: 0xdddddd, shading: THREE.FlatShading } );

    // backing plane for visual reference
    var planeSize = Math.min(render_context.width, render_context.height);
    // use planeSize when we correctly scale height/width
    var planeGeometry = new THREE.PlaneGeometry( render_context.width, render_context.height);
    var planeMaterial = new THREE.MeshBasicMaterial( {color: 0xaaaaaa, side: THREE.DoubleSide} );
    var plane = new THREE.Mesh( planeGeometry, lambertMaterial );
    plane.position.x = render_context.width / 2;
    plane.position.y = render_context.height / 2;
    plane.position.z = 0;
    render_context.scene.add(plane);

    var pointLight = new THREE.PointLight(0xffffff, 1);
    pointLight.position.set(render_context.width, render_context.height, 300);
	render_context.scene.add( new THREE.AmbientLight( 0x111111 ) );
    render_context.scene.add( pointLight );


    REFPLANE = plane;
    console.log("Setting camera at ", center.x, max.y*1.5, max.z);
    render_context.camera.position.set(center.x, max.y*1.5, max.z);
    render_context.controls.target.set(center.x, center.y, center.z);
    render_context.camera.lookAt(center.x, center.y, center.z);

    //console.log("Kicking off render with ", render_context.scene, render_context.camera);
}

// creates a filter from the current state of the UI controls, where the filter is in the form
// [[key, value], [key, value]]
// the key, value will be passed to matches?
function make_filters() {
    var results = [];

    // generate filter
    var profilePage = document.querySelector('#main');
    var facet_list = profilePage.$.facet_list;
    console.log("List is here: ", facet_list, " with selectors: ", facet_list.selectors().length);
    FL = facet_list;
    return facet_list.getFilterValues();
}

function run_filters(activities) {
    var result = [];
    var filters = make_filters();
    console.log("Runnning filters against ", filters);
    for (var i = 0; i < activities.length; i++) {
        var activity = activities[i];
        var matches = true;
        for (var j = 0; j < filters.length; j++) {
            var filter = filters[j];
            var facet = filter[0];
            var facet_value = filter[1];

            var activity_value = facet.extract(facet.keyPath, activity);
            if (!facet.matches(facet_value, activity_value)) {
                matches = false;
                break;
            }
        }

        if (matches) {
            result.push(activity);
        }
    }
    return result;
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
                //console.log("Requesting ", url);
                xhr.send();
            } catch (ex) {
                total_complete +=1;
                update_progress();
                reject(ex);
            };
        });
    };
}

function refresh(render_context) {
    console.log("refreshing..");
    return D.activities().then(function(activities) {
        updatemap(render_context, activities);
    }).catch(function(ex) { console.error(ex); });
}

// given a keylist like ['foo', 'bar'] extracts the corresponding
// objects from obj, i.e. returns [obj.foo, obj.bar]
function extract_key_list_value(keyPath, obj) {
    var key_value = [];
    keyPath.forEach(function(subkey) {
        key_value.push(obj[subkey]);
    });
    return key_value;
}

function extract_key_value(key, obj) {
    return obj[key] || "(none)";
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
    return a == b;
}

var DAYS = [ "Sun", "Mon", "Tue", "Wed", "Thurs", "Fri", "Sat"];
function extract_day_of_week(key, obj) {
    var value = extract_key_value(key, obj);
    var day = new Date(value).getDay();
    return DAYS[day];
}

function display_city(values, count) {
    if (count === undefined)
        return values[0];
    return values[0] + " (" + count + ")";
}

function display_value(value, count) {
    if (count === undefined)
        return value;
    return value + " (" + count + ")";
}

// FACETS defines the UI
// name: The name in the UI
// id: A unique id for use in the DOM or in dictionaries
// keyPath: The path to extract a key, used by the extraction methods
// extract: A function that can extract keys, passed the keyPath.
// matches: Used to check if the result to 'extract' matches the given value.
// display: Returns a display name for the UI, including a count.
var FACETS = [
    { name: 'Location',
      id: 'location',
      keyPath: ['location_city', 'location_state', 'location_country'],
      extract: extract_key_list_value,
      matches: equals_lists,
      display: display_city,
    },
    { name: 'Type',
      id: 'type',
      keyPath: 'type',
      extract: extract_key_value,
      matches: equals,
      display: display_value,
    },
    { name: 'Day of Week',
      id: 'day_of_week',
      keyPath: 'start_date',
      extract: extract_day_of_week,
      matches: equals_day_of_week,
      display: display_value,
    },
    { name: 'Gear',
      id: 'gear_id',
      keyPath: 'gear_id',
      extract: extract_key_value,
      matches: equals,
      display: display_value,
    },
];

var FACETS_BY_ID = {};
FACETS.forEach(function(facet) {
    FACETS_BY_ID[facet.id] = facet;
});

function update_progress_indicator(waiting, complete) {
    var profilePage = document.querySelector('#main');
    var progress = profilePage.$.progress;
    progress.value = complete;
    progress.max = waiting;
    // TODO: Hide if complete == waiting?
}

Profile.init = function() {
    console.log("init()!");
    var profilePage = document.querySelector('#main');
    var context = init3d(profilePage);

    var refreshAjax = profilePage.$['refresh-data'];
    var refreshButton = profilePage.$['refresh-button'];
    refreshAjax.addEventListener('core-complete', function() {
        refreshButton.icon = 'refresh';
        console.log("refresh Complete. Response: ", refreshAjax.response);
        refresh(context);
    });
    profilePage.$['refresh-button'].addEventListener("click", function(e) {
        if (refreshAjax.loading) return;
        refreshButton.icon = 'radio-button-off';
        refreshAjax.go();
        console.log("Loading..");
    });
    console.log("Event handlers hooked up");

    XHR = xhrContext(update_progress_indicator);

    D = new Dataset();
    D.raw_activities().then(function(activities) {
        console.log("Have activities from dataset: ", activities.length, " facets: ", FACETS);

        var facetValues = extract_possible_facet_values(activities);

        console.log("Extracted facet values: ", facetValues);
        profilePage.$.facet_list.facets = facetValues;
    }).catch(function(e) {
        console.error("oops: ", e);
    });
    profilePage.$.facet_list.addEventListener(
        'facet-value',
        function() {
            refresh(context);
        });

    refresh(context);
    C = context;
}

function extract_possible_facet_values(activities) {
    var facetInfos = [];
    FACETS.forEach(function(facet) {
        console.log("Facet: ", facet);

        var key_counts = {};
        var key_string = JSON.stringify(facet.keyPath);
        // extract all possible key values
        activities.forEach(function(activity) {
            var key_value = facet.extract(facet.keyPath, activity);
            var keyString = JSON.stringify(key_value);
            if (!(keyString in key_counts))
                key_counts[keyString] = 0;
            key_counts[keyString] += 1;
        });

        // This wrapps the current facet, and all of the possible values
        var facetInfo = {
            facet: facet,
            values: []
        };
        console.log("    Extracted counts: ", Object.keys(key_counts));

        // now build up the facet UI
        // (Note this will get way more complex in a bit)
        Object.keys(key_counts).forEach(function(key) {
            var count = key_counts[key];
            facetInfo.values.push({
                name: facet.display(JSON.parse(key)),
                count: count,
                value: JSON.parse(key),
            });
        });
        facetInfos.push(facetInfo);
    });
    return facetInfos;
}

// if (document.body.hasAttribute('unresolved')) {
//     console.log("Waiting for polymer-ready");
//     window.addEventListener('polymer-ready', Profile.init);
// } else {
//     console.log("Polymer already ready..");
//     Promise.resolve().then(Profile.init);
// }
console.log("profile.js loaded, should be calling other stuff");