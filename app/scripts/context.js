/**
 * Setup. Returns a "rendering context" that will need to also be
 * populated with a scene and a camera.
 */
function RenderContext(canvas) {
    this.renderer = new THREE.WebGLRenderer({
            canvas: canvas
    });
    // this.renderer.setSize(1000, 1000);
    this.canvas = canvas;
    this.materials_ = {};
    this.line_materials_ = {};
    this.spheres_ = {};
    this.pending_render = false;
}
RenderContext.MAX_SPHERES = 100;

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
RenderContext.prototype.updatemap = function(streamset) {
    streamset.ready().then(function() {
        this.updatescene(streamset);
        this.render_loop();
    }.bind(this)).catch(function(ex) { console.error(ex); });
};

RenderContext.prototype.ensureCamera = function() {
    if (!this.camera) {
        // start with a perspective of 1, and then
        this.camera =
            new THREE.PerspectiveCamera( 75,
                                         1, 0.1, 3000 );
        // Create an event listener that resizes the renderer with the browser window.
        window.addEventListener('resize', this.onResize.bind(this));
        this.onResize();

        this.camera.up.set(0,0,1);
        this.controls = new THREE.OrbitControls(this.camera, this.canvas);
        this.controls.addEventListener('change', this.onControlsChange.bind(this));
    }
};

/**
 * Called when the user resizes the window
 */
RenderContext.prototype.onResize = function() {
    this.rect = { width: 1000,
                  height: 1000 };
    var windowrect = this.canvas.getBoundingClientRect();
    var perspective = windowrect.width / windowrect.height;
    this.ensureCamera();
    this.camera.aspect = perspective;
    this.camera.updateProjectionMatrix();
    this.onControlsChange();
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

RenderContext.prototype.getLineMaterial = function(color, linewidth) {
    if (linewidth === undefined)
        linewidth = 1;

    var key = [color, linewidth].join('\n');

    if (!(key in this.line_materials_)) {
        this.materials_[key] = new THREE.LineBasicMaterial( {
            color: color,
            linewidth: linewidth,
        } );
    }
    return this.line_materials_[linewidth];
};

RenderContext.prototype.getSphere = function(radius) {
    if (!(radius in this.spheres_)) {
        this.spheres_[radius] = new THREE.SphereGeometry(radius, 16, 12);
    }
    return this.spheres_[radius];
};

/**
 * Return a vector for the normal from start that generally follows
 * "points" - points will be given descending weights.
 *
 * @param start THREE.Vector3
 * @param points Array of THREE.Vector3
 * @param color The color for the line
 * @param scale_z d3.scale.linear - this is temporary - really all of
 *     the points should be pre-scaled.
 */
RenderContext.prototype.InterpolateNormal = function(start, points, color) {
    var nextPoint = points[0];
    if (nextPoint) {
        var nextX = nextPoint[0];
        var nextY = nextPoint[1];
        var nextZ = nextPoint[2];
        var nextPointVector = new THREE.Vector3(nextX, nextY, nextZ);
        nextPointVector.sub(start);
        nextPointVector.multiplyScalar(10);
        nextPointVector.add(start);

        var pointerGeometry = new THREE.Geometry();
        pointerGeometry.vertices.push(start);
        pointerGeometry.vertices.push(nextPointVector);

        var pointerMaterial = this.getLineMaterial(color, 1);
        var pointerLine = new THREE.Line(pointerGeometry, pointerMaterial);
        return pointerLine;
    }
}

RenderContext.prototype.add_activities_to_scene = function(streamset) {
    var color = d3.scale.ordinal().range(colorbrewer.Set3[12]);

    var proximityRadius = d3.scale.linear().domain([1, streamset.maxProximity_]);
    proximityRadius.rangeRound([0, 4]);
    console.log("Proximities mapping ", proximityRadius.domain(), " => ", proximityRadius.range());

    var totalspheres = 0;
    RCV = this.view;

    var bucketStreams = this.view.allBucketStreams();

    bucketStreams.forEach(function(activitystream, index) {
        var geometry = new THREE.Geometry();
        var spherecount = 0;
        activitystream.forEach(function(point, i) {
            var proximity = point[3];

            var x = point[0];
            var y = point[1];
            var z = point[2];

            var pointVector = new THREE.Vector3(x, y, z);
            geometry.vertices.push(pointVector);

            var normalLine = this.InterpolateNormal(
                pointVector,
                activitystream.slice(i, i+1),
                color(index));
            this.scene.add(normalLine);

            // gad this is expensive
            var radius = proximityRadius(Object.keys(proximity).length);
            if (radius >= 1) {
                spherecount++;
                var sphere = this.getSphere(radius);
                var material = this.getMaterial(color(index));
                var sphereMesh = new THREE.Mesh(sphere, material);

                sphereMesh.position.set(x,y,z);
                this.scene.add(sphereMesh);
            }
        }.bind(this));

        totalspheres += spherecount;
        var material = new THREE.LineBasicMaterial({
            color: color(index),
            linewidth: 2
        });

        geometry.computeBoundingBox();
        var line = new THREE.Line(geometry, material);
        this.scene.add(line);
    }, this);
    console.log("Total spheres: ", totalspheres);

    this.add_point_planes_to_scene();
};

/**
 * break a polygon up into a series of triangles, with 'center' at the
 * center
 *
 * @param center The coordinates of the 'center' of the polygon
 * @param polygon An array of coordinates.
 * @param links An array of coordinates pairs [source, target] that start or end
 *              at the center.
 */
function shatter(center, polygon, links) {
    // TODO: find places where links cross polygon sides
    var triangles = [];
    for (var i = 0; i < polygon.length-1; i++) {
        var point1 = polygon[i];
        var point2 = polygon[i+1];
        var found_cross = null;
        for (var j = 0; j < links.length; j++) {
            var link = links[j];
            found_cross = cross_point([point1, point2],
                                      [link.source, link.target]);
            if (found_cross) {
                break;
            }
        }

        // XXX still losing elevation here.
        // elevation at cross?
        if (found_cross) {
            triangles.push([center, polygon[i], found_cross]);
            triangles.push([center, found_cross, polygon[i+1]]);
        } else {
            triangles.push([center, polygon[i], polygon[i+1]]);
        }
    }
    triangles.push([center, polygon[i], polygon[0]]);
    return triangles;
}

function equals2d(point1, point2) {
    return (point1[0] == point2[0] &&
            point1[1] == point2[1]);
}

/**
 * Find the point where two lines cross, if any.
 *
 * @param line1 A pair of coordinates.
 * @param line2 A pair of coordinates.
 * @return A pair of coordinates, or null if they don't cross.
 */
function cross_point(line1, line2) {
    // implementation borrowed from
    // http://www.kevlindev.com/gui/math/intersection/Intersection.js
    // More details:
    // http://stackoverflow.com/questions/563198/how-do-you-detect-where-two-line-segments-intersect
    var a1 = line1[0];
    var a2 = line2[1];
    var b1 = line2[0];
    var b2 = line2[1];
    var ua_t = (b2[0] - b1[0]) * (a1[1] - b1[1]) - (b2[1] - b1[1]) * (a1[0] - b1[0]);
    var ub_t = (a2[0] - a1[0]) * (a1[1] - b1[1]) - (a2[1] - a1[1]) * (a1[0] - b1[0]);
    var u_b  = (b2[1] - b1[1]) * (a2[0] - a1[0]) - (b2[0] - b1[0]) * (a2[1] - a1[1]);

    if (u_b) {
        var ua = ua_t / u_b;
        var ub = ub_t / u_b;

        return [a1[0] + ua * (a2[0] - a1[0]),
                a1[1] + ua * (a2[1] - a1[1])];
    } else {
        if (!ua_t || !ub_t) {
            // coincident
        } else {
            // parallel
        }
    }

    return null;
}

/**
 * Adds planes for voroni polygons.
 *
 * Initially, just adds each plane elevated up to the elevation of the point itself.
 *
 * Eventually we'll find all the paths in and out of each coordinate, and adjust the
 */
RenderContext.prototype.add_point_planes_to_scene = function() {
    var color = d3.scale.ordinal().range(colorbrewer.Set3[12]);
    var voronoi = d3.geom.voronoi()
            .clipExtent([[0,0], [this.view.width, this.view.height]]);

    var coordinates = this.view.allBucketCoordinates();

    var polygons = voronoi(coordinates);

    // rejoin x,y with the z and other points from the coordinates
    polygons = polygons.map(function(polygon, i) {
        return polygon.map(function(point) {
            return [point[0], point[1]].concat(coordinates[i].slice(2));
        });
    });

    // Note that these are all links, not necessarily just links seen
    // by known paths from the data.
    var links = voronoi.links(coordinates);
    //console.log("Got links: ", links);

    // console.log("Got 3d polygons: ", polygons);
    //
    // index all the links by their source and target, so that we can
    // iterate the polygons and find what links come out of them

    var links_by_coordinates = {};
    function node_key(coord) {
        return coord.slice(0,2).join('\n');
    }
    function add_node_link(node, link) {
        var key = node_key(node);
        if (!(key in links_by_coordinates)) {
            links_by_coordinates[key] = [];
        }
        links_by_coordinates[key].push(link);
    }
    links.forEach(function(link) {
        add_node_link(link.source, link);
        add_node_link(link.target, link);
    });

    // console.log("Indexed links: ", links_by_coordinates);

    // links out of each coordinate
    var links_out = coordinates
            .map(function(coordinate) {
                return links_by_coordinates[node_key(coordinate)];
            });
    // console.log("Now have links out: ", links_out);
    var showPolygons = true;
    var showTriangles = false;

    var shapes = [];
    var triangles = [];
    polygons.forEach(function(polygon, i) {
        var links = links_by_coordinates[node_key(coordinates[i])];
        var shattered = shatter(coordinates[i], polygon, links_out[i]);

        shattered.forEach(function(triangle) {
            triangles.push(triangle);
        });

        if (showPolygons) {
            var points = polygon.map(function(point) {
             return new THREE.Vector3(point[0], point[1], point[2]);
            });
            var polygonPathShape = new THREE.Shape(points);
            var polygonGeo = new THREE.ShapeGeometry(polygonPathShape);
            // This makes some pretty neat stair-stepping
            //var polygonGeo = polygonPathShape.extrude({amount:polygon[0][2]});
            shapes.push(polygonPathShape);
            var material = this.getMaterial(color(i));

            var mesh = new THREE.Mesh(polygonGeo, material);
            // Shapes are 2d, so they also have to be repositioned.
            mesh.position.set(0,0,polygon[0][2]);
            this.scene.add(mesh);
        }

        if (showTriangles) {
            shattered.forEach(function(triangle, j) {
                var tshape = new THREE.Triangle(
                    new THREE.Vector3(triangle[0][0], triangle[0][1], polygon[0][2]),
                    new THREE.Vector3(triangle[1][0], triangle[1][1], polygon[0][2]),
                    new THREE.Vector3(triangle[2][0], triangle[2][1], polygon[0][2]));
                var material = this.getMaterial(color(j));
                var mesh = new THREE.Mesh(tshape, material);
                this.scene.add(mesh);
            }, this);
        }
    }, this);
    // console.log("Created geometries: ", shapes);
    // console.log("With extra triangles: ", triangles);
};

RenderContext.prototype.add_backing_plane = function() {
    var lambertMaterial =
            new THREE.MeshLambertMaterial( { color: 0xdddddd, shading: THREE.FlatShading } );
    // backing plane for visual reference
    var planeGeometry = new THREE.PlaneGeometry( this.rect.width, this.rect.height);
    var planeMaterial = new THREE.MeshBasicMaterial( {color: 0xaaaaaa, side: THREE.DoubleSide} );
    var plane = new THREE.Mesh( planeGeometry, lambertMaterial );
    plane.position.x = this.rect.width / 2;
    plane.position.y = this.rect.height / 2;
    plane.position.z = 0;
    this.scene.add(plane);
};

RenderContext.prototype.add_light = function() {
    var pointLight = new THREE.PointLight(0xffffff, 1);
    pointLight.position.set(this.rect.width, this.rect.height, 300);
	this.scene.add( new THREE.AmbientLight( 0x111111 ) );
    this.scene.add( pointLight );
};

RenderContext.prototype.updatescene = function(streamset) {

    this.ensureCamera();
    this.view = new StreamSetView(streamset, this.rect.width, this.rect.height);
    if (this.view) {
        // reverse x
        this.view.scale_x.domain([0, this.rect.width])
            .range([this.rect.width, 0]);
        // This should all be done inside the view.
        var ppm = d3.mean(this.view.pixelsPerMeter()) * 10;
        console.log("Got ", ppm, " pixelsPerMeter");
        this.view.scale_z.domain([0,100]).range([0, 100*ppm]);
    }

    var max_z = -1;
    var min_z = -1;
    this.scene = new THREE.Scene();
    this.add_activities_to_scene(streamset);

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
};


function RenderContext2d(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.pending_render = false;
    window.addEventListener('resize', this.onResize.bind(this));
    this.onResize();
}

RenderContext2d.prototype.onResize = function(event) {
    var rect = this.canvas.getBoundingClientRect();
    this.canvas.setAttribute("width", rect.width);
    this.canvas.setAttribute("height", rect.height);
    this.updatescene();
};

RenderContext2d.prototype.updatemap = function(streamset) {
    streamset.ready().then(function() {
        this.streamset = streamset;
        this.updatescene();
        this.render_loop();
    }.bind(this)).catch(function(ex) { console.error(ex); });
};

RenderContext2d.prototype.updatescene = function() {
    // XXX should be waiting for ready
    if (!this.streamset)
        return;
    // this is kinda nasty - it is expensive to create a streamsetview
    var rect = this.canvas.getBoundingClientRect();
    this.view = new StreamSetView(this.streamset, rect.width, rect.height);
    SS = this.streamset;
    SV = this.view;

    this.ctx.fillStyle = '#fff';
    this.ctx.fillRect(0, 0, rect.width, rect.height);

    this.draw_gridlines();
    this.draw_background();

    //this.draw_activities();

    this.draw_simplified_activities();
};

RenderContext2d.prototype.draw_activities = function() {
    this.ctx.save();
    this.ctx.strokeStyle = 'black';
    this.ctx.lineWidth = 1;

    var path = d3.geo.path().projection(this.view.projection);
    path.context(this.ctx);

    this.streamset.activities().forEach(function(activity) {
        this.ctx.beginPath();
        // actually write to the context
        path(activity.stream.geojson);
        this.ctx.closePath();
        this.ctx.stroke();
    }, this);
    this.ctx.restore();
};

RenderContext2d.prototype.draw_simplified_activities = function() {
    this.ctx.save();
    var color = d3.scale.ordinal().range(colorbrewer.Set3[12]);
    var path = d3.geo.path().projection(this.view.projection);
    path.context(this.ctx);
    this.streamset.allBucketStreams().forEach(function(stream, index) {
        // hack
        var stream_geojson = {
          type: 'Feature',
          geometry: {
            type: 'LineString',
              coordinates: stream,
          }
        };
        this.ctx.lineWidth = 3;
        this.ctx.strokeStyle = '#eee';
        this.ctx.beginPath();
        path(stream_geojson);
        this.ctx.closePath();
        this.ctx.stroke();

        this.ctx.lineWidth = 2;
        this.ctx.strokeStyle = color(index);
        this.ctx.beginPath();
        path(stream_geojson);
        this.ctx.closePath();
        this.ctx.stroke();
    }, this);
    this.ctx.restore();
};

/**
 * Use voronoi to draw spaces around each coordinates.
 */
RenderContext2d.prototype.draw_background = function() {
    this.ctx.save();
    console.log("2d draw background ", this.view.width, this.view.height);
    if (!this.view.width || !this.view.height)
        return;
    // make some vornoi!
    var voronoi = d3.geom.voronoi()
            .clipExtent([[0,0], [this.view.width, this.view.height]]);

    // var buckets_by_bucketindex =
    //         ExtractProximityData(streamset.bucketCount);

    this.ctx.lineWidth = 1;
    // convert to screen space
    //var coordinates = this.view.allCoordinates();
    var coordinates = this.view.allBucketCoordinates();
    var triangles = voronoi.triangles(coordinates);
    // this.ctx.strokeStyle = '#eee';
    // triangles.forEach(function(triangle) {
    //     this.ctx.beginPath();
    //     this.ctx.moveTo(triangle[0][0], triangle[0][1]);
    //     triangle.forEach(function(point) {
    //         this.ctx.lineTo(point[0], point[1]);
    //     }, this);
    //     this.ctx.closePath();
    //     this.ctx.stroke();
    // }, this);
    var polygons = voronoi(coordinates);
    this.ctx.strokeStyle = '#bbb';
    polygons.forEach(function(polygon, i) {
        this.ctx.beginPath();
        this.ctx.moveTo(polygon[0][0], polygon[0][1]);
        polygon.forEach(function(point) {
            this.ctx.lineTo(point[0], point[1]);
        }, this);
        this.ctx.closePath();
        this.ctx.stroke();
    }, this);

    this.ctx.restore();
    console.log("Got ", polygons.length, " polygons and ", triangles.length, " triangles from ", coordinates.length);
};

RenderContext2d.prototype.draw_gridlines = function() {
    this.ctx.save();
    this.ctx.lineWidth = 0.5;
    this.ctx.strokeStyle = '#eee';
    var lat_range = this.streamset.bucket_lat.range();
    var lng_range = this.streamset.bucket_lng.range();
    var lng_start = this.streamset.bucket_lng.invert(lng_range[0]);
    var lng_end = this.streamset.bucket_lng.invert(lng_range[1]);
    var lat_start = this.streamset.bucket_lat.invert(lat_range[0]);
    var lat_end = this.streamset.bucket_lat.invert(lat_range[1]);
    var p;
    for (var i = lat_range[0]; i < lat_range[1]; i+=4) {
        var lat = this.streamset.bucket_lat.invert(i);


        p = this.view.projection([lng_start, lat]);
        this.ctx.moveTo(p[0], p[1]);
        p = this.view.projection([lng_end, lat]);
        this.ctx.lineTo(p[0], p[1]);
        this.ctx.stroke();
    }
    for (var j = lng_range[0]; j < lng_range[1]; j+=4) {
        var lng = this.streamset.bucket_lng.invert(j);
        var p;
        p = this.view.projection([lng, lat_start]);
        this.ctx.moveTo(p[0], p[1]);
        p = this.view.projection([lng, lat_end]);
            this.ctx.lineTo(p[0], p[1]);
        this.ctx.stroke();
    }
    this.ctx.restore();
};



RenderContext2d.prototype.render_loop = function() {
    if (!this.pending_render)
	    requestAnimationFrame(this.render.bind(this));
    this.pending_render = true;
};

RenderContext2d.prototype.render = function() {

};
