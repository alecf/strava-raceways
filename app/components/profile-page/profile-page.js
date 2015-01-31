Polymer('profile-page', {
    facetSelected: function(e) {
        console.log("Filters should be updated with ", e.facet.id, " = ", e.value.value);
    },
    ready: function() {
        console.log("profile-page ready");

        Profile.init();
    },
    onRefresh: function() {

    }
});
