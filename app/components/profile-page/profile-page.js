Polymer('profile-page', {
    facetSelected: function(e) {
        console.log("Filters should be updated with ", e.facet.id, " = ", e.value.value);
        this.profile.refresh();
    },
    ready: function() {
        console.log("profile-page ready");

        this.profile = new Profile(this);
        this.profile.init();
    },
    onRefresh: function() {

    }
});
