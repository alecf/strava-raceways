function Dataset() {
    this._pending_activities =
        XHR('/api/activities').then(function(response) {
            console.log("Got activities: ", response);
            return response.result.activities;
        });
}

Dataset.prototype.raw_activities = function() {
    return this._pending_activities;
};

Dataset.prototype.activities = function() {
    return this._pending_activities.then(function(activities) {
        return run_filters(activities);
    });
};
