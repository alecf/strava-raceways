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
        if (this.$['refresh-data'].loading) return;
        this.$['refresh-button'].icon = 'radio-button-off';
        this.$['refresh-data'].go();
        console.log("Loading..");
    },
    onDataLoaded: function() {
        refreshButton.icon = 'refresh';
        console.log("refresh Complete. Response: ", refreshAjax.response);
        this.profilePage.refresh();
    },
});
