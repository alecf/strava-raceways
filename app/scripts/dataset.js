function Dataset(facetList, xhr, resolution) {
    this.facetList = facetList;
    this.xhr_ = xhr;
    this._pending_activities =
        this.xhr_('/api/activities').then(function(response) {
            console.log("Got activities: ", response);
            return response.result.activities;
        });
}

Dataset.prototype.raw_activities = function() {
    return this._pending_activities;
};

Dataset.prototype.activities = function() {
    return this._pending_activities.then(function(activities) {
        return this.run_filters(activities);
    }.bind(this));
};

Dataset.prototype.run_filters = function(activities) {
    var result = [];
    var filters = this.facetList.getFilterValues();
    console.log("Runnning filters against ", filters);
    for (var i = 0; i < activities.length; i++) {
        var activity = activities[i];
        var matches = true;
        for (var j = 0; j < filters.length; j++) {
            var filter = filters[j];
            var facet = filter[0];
            var facet_value = filter[1];

            var activity_value = facet.extract(facet.keyPath, activity);
            // Should this be handled by facet.matches?
            if (facet_value != null &&
                !facet.matches(facet_value, activity_value)) {
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

Dataset.prototype.make_filters = function() {
    // generate filter
    console.log("List is here: ", this.facetList, " with selectors: ", this.facetList.selectors().length);
    return this.facetList.getFilterValues();
};
