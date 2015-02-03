/**
 * Setup. Returns a "rendering context" that will need to also be
 * populated with a scene and a camera.
 */
function init3d(canvas) {
    console.log("Ready with canvas on ", canvas);
    return new RenderContext(canvas);
}

function RenderContext(canvas) {
    this.renderer = new THREE.WebGLRenderer({
            canvas: canvas
    });
    this.canvas = canvas;
    this.height = 300;
    this.width = 400;
    this.materials_ = {};
}


RenderContext.prototype.render3d = function() {
    this.controls.update();
	this.renderer.render(this.scene, this.camera);
    pending_render = false;
};

var pending_render = false;
RenderContext.prototype.render_loop = function() {
    if (!pending_render)
	    requestAnimationFrame(this.render3d.bind(this));
    pending_render = true;
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

RenderContext.prototype.ensureCamera = function() {
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
};

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
    var planeSize = Math.min(this.width, this.height);
    // use planeSize when we correctly scale height/width
    var planeGeometry = new THREE.PlaneGeometry( this.width, this.height);
    var planeMaterial = new THREE.MeshBasicMaterial( {color: 0xaaaaaa, side: THREE.DoubleSide} );
    var plane = new THREE.Mesh( planeGeometry, lambertMaterial );
    plane.position.x = this.width / 2;
    plane.position.y = this.height / 2;
    plane.position.z = 0;
    this.scene.add(plane);
};

RenderContext.prototype.add_light = function() {
    var pointLight = new THREE.PointLight(0xffffff, 1);
    pointLight.position.set(this.width, this.height, 300);
	this.scene.add( new THREE.AmbientLight( 0x111111 ) );
    this.scene.add( pointLight );
};

RenderContext.prototype.updatescene = function(bounds, activities) {

    this.ensureCamera();
    bounds.setSize(this.canvas.width, this.canvas.height);

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

    var vShader = document.querySelector('#vertexShader').innerText;
    var fShader = document.querySelector('#fragmentShader').innerText;
    var shaderMaterial =
            new THREE.ShaderMaterial({
                vertexShader:   vShader,
                fragmentShader: fShader
            });

    this.add_backing_plane();

    this.add_light();


    console.log("Setting camera at ", center.x, max.y*1.5, max.z);
    this.camera.position.set(center.x, max.y*1.5, max.z);
    this.controls.target.set(center.x, center.y, center.z);
    this.camera.lookAt(center.x, center.y, center.z);

    //console.log("Kicking off render with ", this.scene, this.camera);
};
