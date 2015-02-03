
// Create an XHR context that fires off progress notifications
// usage:
// function update_progress(waiting, total) {
//   console.log("Updated ", waiting, " / ", total);
// }
// var XHR = xhrContext(update_progress);
// XHR('http://....).then(function(result)) {... });
function XHRContext(progress) {
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

function Profile(profilePage) {
    this.profilePage = profilePage;
}


Profile.prototype.update_progress_indicator = function(waiting, complete) {
    var progress = this.profilePage.$.progress;
    progress.value = complete;
    progress.max = waiting;
    // TODO: Hide if complete == waiting?
};

Profile.prototype.init = function() {
    this.context = init3d(this.profilePage.$.canvas3d);

    var refreshAjax = this.profilePage.$['refresh-data'];
    var refreshButton = this.profilePage.$['refresh-button'];
    refreshAjax.addEventListener('core-complete', function() {
        refreshButton.icon = 'refresh';
        console.log("refresh Complete. Response: ", refreshAjax.response);
        this.refresh();
    }.bind(this));
    this.profilePage.$['refresh-button'].addEventListener("click", function(e) {
        if (refreshAjax.loading) return;
        refreshButton.icon = 'radio-button-off';
        refreshAjax.go();
        console.log("Loading..");
    });
    console.log("Event handlers hooked up");

    XHR = XHRContext(this.update_progress_indicator.bind(this));

    this.dataset = new Dataset(this.profilePage.$.facet_list);

    this.dataset.raw_activities().then(function(activities) {
        console.log("Have activities from dataset: ", activities.length, " facets: ", FACETS);

        var facetValues = extract_possible_facet_values(activities);

        console.log("Extracted facet values: ", facetValues);
        this.profilePage.$.facet_list.facets = facetValues;
    }.bind(this)).catch(function(e) {
        console.error("oops: ", e);
    });
    // profilePage.$.facet_list.addEventListener('facet-value', this.refresh.bind(this));
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