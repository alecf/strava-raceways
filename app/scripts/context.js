/**
 * Setup. Returns a "rendering context" that will need to also be
 * populated with a scene and a camera.
 */
function RenderContext(canvas) {
    this.renderer = new THREE.WebGLRenderer({
            canvas: canvas
    });
    this.canvas = canvas;
    this.materials_ = {};
    this.pending_render = false;
}

RenderContext.prototype.render3d = function() {
    this.controls.update();
	this.renderer.render(this.scene, this.camera);
    this.pending_render = false;
};

RenderContext.prototype.render_loop = function() {
    if (!this.pending_render)
	    requestAnimationFrame(this.render3d.bind(this));
    this.pending_render = true;
};

/**
 * Update the map
 */
RenderContext.prototype.updatemap = function(bounds) {
    bounds.ready().then(function() {
        this.updatescene(bounds, bounds.activities());
        this.render_loop();
    }.bind(this)).catch(function(ex) { console.error(ex); });
};

RenderContext.prototype.perspective = function() {
    var rect = this.canvas.getBoundingClientRect();
    return rect.width/rect.height;
};

RenderContext.prototype.ensureCamera = function() {
    console.log("Ensuring camera, perspective = ", this.perspective());
    if (!this.camera) {
        this.camera =
            new THREE.PerspectiveCamera( 75,
                                         this.perspective(), 0.1, 1000 );
        // Create an event listener that resizes the renderer with the browser window.
        window.addEventListener('resize', this.onResize.bind(this));

        this.controls = new THREE.OrbitControls(this.camera, this.canvas);
        this.camera.up.set(0,0,1);
        this.controls.addEventListener('change', this.onControlsChange.bind(this));
    }
};

/**
 * Called when the user resizes the window
 */
RenderContext.prototype.onResize = function() {
    //this.renderer.setSize(WIDTH, HEIGHT);
    console.log("Resizing camera, perspective = ", this.perspective());
    this.camera.aspect = this.perspective();
    this.camera.updateProjectionMatrix();
};

/**
 * Called when the user manipulates the controls (i.e. updates the camera)
 */
RenderContext.prototype.onControlsChange = function() {
    // just redraw, don't recreate the scene
    this.render_loop();
};

/**
 * A cache of materials by color.
 */
RenderContext.prototype.getMaterial = function(color) {
    if (!(color in this.materials_)) {
        this.materials_[color] = new THREE.MeshLambertMaterial( {
            color: color,
            shading: THREE.FlatShading
        } );
    }
    return this.materials_[color];
};

RenderContext.prototype.add_activities_to_scene = function(bounds, activities) {
    var color = d3.scale.ordinal().range(colorbrewer.Set3[12]);

    var proximityRadius = d3.scale.linear().domain([1, bounds.maxProximity_]);
    proximityRadius.rangeRound([0, 4]);

    var totalspheres = 0;
    var materials = {};

    activities.forEach(function(activity, index) {
        var lambertMaterial = this.getMaterial(color(index));

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

};

RenderContext.prototype.add_backing_plane = function() {
    var lambertMaterial =
            new THREE.MeshLambertMaterial( { color: 0xdddddd, shading: THREE.FlatShading } );
    // backing plane for visual reference
    var rect = this.canvas.getBoundingClientRect();
    var planeSize = Math.max(rect.width, rect.height);
    // use planeSize when we correctly scale height/width
    var planeGeometry = new THREE.PlaneGeometry( planeSize, planeSize);
    var planeMaterial = new THREE.MeshBasicMaterial( {color: 0xaaaaaa, side: THREE.DoubleSide} );
    var plane = new THREE.Mesh( planeGeometry, lambertMaterial );
    plane.position.x = planeSize / 2;
    plane.position.y = planeSize / 2;
    plane.position.z = 0;
    this.scene.add(plane);
};

RenderContext.prototype.add_light = function() {
    var rect = this.canvas.getBoundingClientRect();
    var pointLight = new THREE.PointLight(0xffffff, 1);
    pointLight.position.set(rect.width, rect.height, 300);
	this.scene.add( new THREE.AmbientLight( 0x111111 ) );
    this.scene.add( pointLight );
};

RenderContext.prototype.updatescene = function(bounds, activities) {

    this.ensureCamera();
    var rect = this.canvas.getBoundingClientRect();
    bounds.setSize(rect.width, rect.height);

    var max_z = -1;
    var min_z = -1;
    this.scene = new THREE.Scene();
    this.add_activities_to_scene(bounds, activities);

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

    // var vShader = document.querySelector('#vertexShader').innerText;
    // var fShader = document.querySelector('#fragmentShader').innerText;
    // var shaderMaterial =
    //         new THREE.ShaderMaterial({
    //             vertexShader:   vShader,
    //             fragmentShader: fShader
    //         });

    this.add_backing_plane();

    this.add_light();


    console.log("Setting camera at ", center.x, max.y*1.5, max.z);
    this.camera.position.set(center.x, max.y*1.5, max.z);
    this.controls.target.set(center.x, center.y, center.z);
    this.camera.lookAt(center.x, center.y, center.z);

    //console.log("Kicking off render with ", this.scene, this.camera);
};


function RenderContext2d(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    console.log("Got context ", this.ctx, " from ", canvas);
    this.pending_render = false;
    window.addEventListener('resize', this.onResize.bind(this));
    this.onResize();
}

RenderContext2d.prototype.onResize = function(event) {
    var rect = this.canvas.getBoundingClientRect();
    this.canvas.setAttribute("width", rect.width);
    this.canvas.setAttribute("height", rect.height);
    console.log("Resized to ", rect.width, ", ", rect.height);
};

RenderContext2d.prototype.updatemap = function(bounds) {
    bounds.ready().then(function() {
        this.updatescene(bounds, bounds.activities());
        this.render_loop();
    }.bind(this)).catch(function(ex) { console.error(ex); });
};

RenderContext2d.prototype.updatescene = function(bounds, activities) {
    var rect = this.canvas.getBoundingClientRect();
    console.log("Setting 2d size to ", rect.width, ", ", rect.height, " from ", this.ctx);
    bounds.setSize(rect.width, rect.height);
    this.ctx.fillStyle = '#fff';
    this.ctx.strokeStyle = 'black';
    this.ctx.fillRect(0, 0, rect.width, rect.height);
    this.ctx.stroke();

    var activityjson = {
        type: 'FeatureCollection',
    };
    activityjson.features = activities.map(function(activity) {
        return activity.stream.geojson;
    });
    var projection = get_best_projection(rect.width, rect.height, activityjson);
    P = projection;
    A = activities;
    activities.forEach(function(activity) {
        var path = d3.geo.path().projection(projection);
        path.context(this.ctx);
        this.ctx.beginPath();
        var p = path(activity.stream.geojson);
        if (p) {
            console.warn("Got path: ", p.length);
        }
        this.ctx.stroke();
        this.ctx.closePath();
        console.log("Creating path for ", activity);
        LP = path;
        LA = activity;
    }, this);
};


/**
 *
 */
function get_best_projection(width, height, features) {
    //var center = d3.geo.centroid(features);
    var scale = 1;            // strawman
    var offset = [0,0];

    var projection = d3.geo.albers()
            .scale(scale)
            //.center(center)
            .translate(offset);

    var path = d3.geo.path().projection(projection);
    var bounds = path.bounds(features);

    scale = 1/Math.max((bounds[1][0] - bounds[0][0]) / width,
                       (bounds[1][1] - bounds[0][1]) / height);
    offset = [(width - scale*(bounds[1][0] + bounds[0][0]))/2,
              (height - scale*(bounds[1][1] + bounds[0][1]))/2];
    // now create a new projection
    projection
        .scale(scale)
        .translate(offset);
    console.log("Created projection:",
                "\n  scale = ", scale,
                "\n  translate = ", offset);
    return projection;
}


RenderContext2d.prototype.render_loop = function() {
    if (!this.pending_render)
	    requestAnimationFrame(this.render.bind(this));
    this.pending_render = true;
};

RenderContext2d.prototype.render = function() {

};