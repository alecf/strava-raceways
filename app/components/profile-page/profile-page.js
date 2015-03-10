console.log("Starting the profile page...");
Polymer('profile-page', {
    publish: {
        totalActivities: 0,
    },
    facetSelected: function(e) {
        console.log("Filters should be updated with ", e.facet.id, " = ", e.value ? e.value.value.value : null);
        this.profile.refresh();
    },
    ready: function() {
        console.log("profile-page ready");

        this.profile = new Profile(this);
        this.profile.init();
    },
    onRefresh: function() {
        if (this.$['refresh-data'].loading) return;
        this.$['refresh-button'].icon = 'radio-button-off';
        this.$['refresh-data'].go();
        console.log("Loading..");
    },
    onDataLoaded: function() {
        this.$['refresh-button'].icon = 'refresh';
        console.log("refresh Complete. Response: ", this.$['refresh-data'].response);
        console.log("Refresh from ", this, " and ", this.profilePage);
        this.profile.refresh();
    },
});
