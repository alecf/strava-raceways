
// generate metadata about all the streams
function index_streams(activities) {
    var results = [];
    console.log("Indexing ", activities);
    for (var i = 0; i < activities.length; ++i) {
        if (!activities[i].stream)
            continue;

        var metadata = {};
        results.push(metadata);

        var latlng_stream = activities[i].stream.latlng;

        if (!latlng_stream)
            continue;
        var alt_stream = activities[i].stream.altitude;

        function lat(data) { return data[0]; }
        function lng(data) { return data[1]; }
        metadata.min_lat = Math.min.apply(Math, latlng_stream.data.map(lat));
        metadata.min_lng = Math.min.apply(Math, latlng_stream.data.map(lng));
        metadata.max_lat = Math.max.apply(Math, latlng_stream.data.map(lat));
        metadata.max_lng = Math.max.apply(Math, latlng_stream.data.map(lng));
        metadata.min_alt = Math.min.apply(Math, alt_stream.data);
        metadata.max_alt = Math.max.apply(Math, alt_stream.data);
    }

    return results;
}

// an object that represents the bounds of a map
// note that there is no projection here
function Bounds(stream_index) {
    function min_lat(data) { return data.min_lat; }
    function min_lng(data) { return data.min_lng; }
    function max_lat(data) { return data.max_lat; }
    function max_lng(data) { return data.max_lng; }

    function min_alt(data) { return data.min_alt; }
    function max_alt(data) { return data.max_alt; }
    var extents = {
        min_lat: Math.min.apply(Math, stream_index.map(min_lat)),
        min_lng: Math.min.apply(Math, stream_index.map(min_lng)),
        max_lat: Math.max.apply(Math, stream_index.map(max_lat)),
        max_lng: Math.max.apply(Math, stream_index.map(max_lng)),

        min_alt: Math.min.apply(Math, stream_index.map(min_alt)),
        max_alt: Math.max.apply(Math, stream_index.map(max_alt)),
    };

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
    this.scale_x.range([0, width]);
    this.scale_y.range([0, height]);
    this.scale_z.range([100, 200]); // lower number = darker = lower altitude
};

function drawmap(activities) {
    var index = index_streams(activities);
    I = index;
    console.log("Have index", index);
    var bounds = new Bounds(index);
    console.log("have bounds", bounds);
    B= bounds;

    drawWithBounds(bounds, activities);
}

function drawWithBounds(bounds, activities) {
    var canvas = document.querySelector('#map');

    bounds.setSize(canvas.width, canvas.height);
    var color = d3.scale.ordinal().range(colorbrewer.Set3[12]);
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0,0,canvas.width, canvas.height);

    // draw altitude gradients first - this is terribly inefficient
    var gradientRadius = canvas.width * 0.02;
    console.log("radius: ", gradientRadius);
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

function make_filter() {
    var test_props = [];
    var test_value = [];

    // generate filter
    var controls = document.querySelectorAll('.map-control');
    for (var i = 0; i < controls.length; ++i) {
        var properties = JSON.parse(controls[i].getAttribute('properties'));
        var criteria = controls[i].querySelectorAll('span.tab');
        for (var j = 0; j < criteria.length; j++) {
            var criterium = criteria[j];
            if (criterium.classList.contains('polymer-selected')) {
                var value = criterium.getAttribute('value');
                if (value != '*') {
                    value = JSON.parse(value);

                    if (value.length != properties.length) {
                        console.warn("prop/value mismatch: ", properties, " vs. ", value);
                        break;
                    }
                    for (var k = 0; k < properties.length; ++k) {
                        test_props.push(properties[k]);
                        test_value.push(value[k]);
                    }
                    console.log("I need to check for ", properties, ' = ', value);
                }
            }
        }
    }

    return [test_props, test_value];
}

function run_filter(activities) {
    var filter = make_filter();
    var props = filter[0];
    var values = filter[1];
    var result = [];
    for (var i = 0; i < activities.length; ++i) {
        var matches = true;
        var activity = activities[i];
        for (var j = 0; j < props.length; ++j) {
            if (activity[props[j]] != values[j]) {
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
function create_filter_ui(activities, properties_list) {

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

function refresh() {
    console.log("refreshing..");
    var filtered_activities = run_filter(activities);

    drawmap(filtered_activities);
}

function init() {
    // hack to filter out activities from other towns
    //var city = activities[0].location_city;
    //activities = activities.filter(function(activity) { return activity.location_city == city; });

    refresh();

    var controls = document.querySelectorAll('.map-control > polymer-ui-tabs');
    for (var i = 0; i < controls.length; ++i) {
        if (!controls[i].hasEventListener) {
            controls[i].addEventListener('polymer-activate', refresh);
            controls[i].hasEventListener = true;
        }
    }
}

// hack hack
if (document.readyState == "complete") {
    init();
} else {
    document.addEventListener('DOMContentLoaded', init);
}