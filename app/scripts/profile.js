
function Profile() {

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

function RenderContext(canvas) {
    this.renderer = new THREE.WebGLRenderer({
            canvas: canvas
    });
    this.canvas = canvas;
    this.height = 300;
    this.width = 400;
}


RenderContext.prototype.render3d = function() {
    this.controls.update();
	this.renderer.render(this.scene, this.camera);
    pending_render = false;
}

var pending_render = false;
RenderContext.prototype.render_loop = function() {
    if (!pending_render)
	    requestAnimationFrame(this.render3d.bind(this));
    pending_render = true;
}

/**
 * Update the map
 */
RenderContext.prototype.updatemap = function(activities) {
    var bounds = new Bounds(activities);
    B = bounds;

    bounds.ready().then(function() {
        this.updatescene(bounds, activities);
        this.render_loop();
    }.bind(this)).catch(function(ex) { console.error(ex); });
}

/**
 * Setup. Returns a "rendering context" that will need to also be
 * populated with a scene and a camera.
 */
function init3d(profile_page) {
    console.log("Ready with canvas on ", profile_page);
    var canvas = profile_page.$.canvas3d;

    return new RenderContext(canvas);
}

RenderContext.prototype.updatescene = function(bounds, activities) {

    if (!this.camera) {
        this.camera =
            new THREE.PerspectiveCamera( 75,
                                         this.width / this.height, 0.1, 1000 );
        // Create an event listener that resizes the renderer with the browser window.
        window.addEventListener('resize', function() {
            var rect = this.canvas.getBoundingClientRect();
            //this.renderer.setSize(WIDTH, HEIGHT);
            this.camera.aspect = rect.width / rect.height;
            this.camera.updateProjectionMatrix();
        });
        this.controls = new THREE.OrbitControls(this.camera, this.canvas);
        this.camera.up.set(0,0,1);
        this.controls.addEventListener('change', function() {
            // just redraw, don't recreate the scene
            this.render_loop();
        }.bind(this));
    }
    bounds.setSize(this.canvas.width, this.canvas.height);
    var proximityRadius = d3.scale.linear().domain([1, bounds.maxProximity_]);
    proximityRadius.rangeRound([0, 4]);

    var color = d3.scale.ordinal().range(colorbrewer.Set3[12]);

    var max_z = -1;
    var min_z = -1;
    var totalspheres = 0;
    this.scene = new THREE.Scene();
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
                this.scene.add(sphereMesh);
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
        this.scene.add(line);
    }, this);

    //console.log("Total of ", totalspheres, " spheres");
    var min = {};
    var max = {};
    var center = {};
    ['x', 'y', 'z'].forEach(function(axis) {
        // super hack - we're using the fact that we haven't computed
        // the bounding boxes for the spheres to filter them out and
        // make this calcuation faster
        max[axis] = d3.max(this.scene.children, function(child) {
            if (child.geometry.boundingBox)
                return child.geometry.boundingBox.max[axis];
        });
        min[axis] = d3.min(this.scene.children, function(child) {
            if (child.geometry.boundingBox)
                return child.geometry.boundingBox.min[axis];
        });
        center[axis] = (max[axis] - min[axis])/2;
    }, this);

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
    var planeSize = Math.min(this.width, this.height);
    // use planeSize when we correctly scale height/width
    var planeGeometry = new THREE.PlaneGeometry( this.width, this.height);
    var planeMaterial = new THREE.MeshBasicMaterial( {color: 0xaaaaaa, side: THREE.DoubleSide} );
    var plane = new THREE.Mesh( planeGeometry, lambertMaterial );
    plane.position.x = this.width / 2;
    plane.position.y = this.height / 2;
    plane.position.z = 0;
    this.scene.add(plane);

    var pointLight = new THREE.PointLight(0xffffff, 1);
    pointLight.position.set(this.width, this.height, 300);
	this.scene.add( new THREE.AmbientLight( 0x111111 ) );
    this.scene.add( pointLight );


    REFPLANE = plane;
    console.log("Setting camera at ", center.x, max.y*1.5, max.z);
    this.camera.position.set(center.x, max.y*1.5, max.z);
    this.controls.target.set(center.x, center.y, center.z);
    this.camera.lookAt(center.x, center.y, center.z);

    //console.log("Kicking off render with ", this.scene, this.camera);
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

Profile.prototype.update_progress_indicator = function(waiting, complete) {
    var progress = this.profilePage.$.progress;
    progress.value = complete;
    progress.max = waiting;
    // TODO: Hide if complete == waiting?
}

Profile.prototype.init = function(profilePage) {
    this.profilePage = profilePage;
    this.context = init3d(profilePage);

    var refreshAjax = profilePage.$['refresh-data'];
    var refreshButton = profilePage.$['refresh-button'];
    refreshAjax.addEventListener('core-complete', function() {
        refreshButton.icon = 'refresh';
        console.log("refresh Complete. Response: ", refreshAjax.response);
        this.refresh();
    }.bind(this));
    profilePage.$['refresh-button'].addEventListener("click", function(e) {
        if (refreshAjax.loading) return;
        refreshButton.icon = 'radio-button-off';
        refreshAjax.go();
        console.log("Loading..");
    });
    console.log("Event handlers hooked up");

    XHR = xhrContext(this.update_progress_indicator.bind(this));

    this.dataset = new Dataset(profilePage.$.facet_list);

    this.dataset.raw_activities().then(function(activities) {
        console.log("Have activities from dataset: ", activities.length, " facets: ", FACETS);

        var facetValues = extract_possible_facet_values(activities);

        console.log("Extracted facet values: ", facetValues);
        profilePage.$.facet_list.facets = facetValues;
    }).catch(function(e) {
        console.error("oops: ", e);
    });
    profilePage.$.facet_list.addEventListener('facet-value', this.refresh.bind(this));
    this.refresh();
};

Profile.prototype.refresh = function() {
    return this.dataset.activities()
        .then(function(activities) {
            this.context.updatemap(activities);
        }.bind(this))
        .catch(function(ex) { console.error(ex); });
};

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

console.log("profile.js loaded, should be calling other stuff");