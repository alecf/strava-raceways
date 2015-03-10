Polymer('facet-selector', {
    publish: {
        facet: {
            name: '',
            id: '',
            // etc - see FACETS in profile.js
        },
        values: [],
    },
    filterValues: function() {
        var results = [];
        var coreItems = this.shadowRoot.querySelectorAll('core-item');
        for (var i=0; i < coreItems.length; i++) {
            var coreItem = coreItems[i];
            var dataItem = coreItem.templateInstance.model.value;
            // surely there's a better way to test selection?
            if (coreItem.classList.contains('core-selected')) {
                var value = dataItem ? dataItem.value : null;
                results.push([this.facet, dataItem.value]);
            }
        }

        return results;
    },
    valueSelected: function(e) {
        console.log("Value selected:", e);
        console.log("templateInstance: ", e.detail.item.templateInstance);
        var model = e.detail.item.templateInstance.model;
        e.stopPropagation();
        var facetEvent = new CustomEvent('facet-value');
        facetEvent.facet = model.facet;
        // this is a bit of a hack
        try {
            facetEvent.value = model.value;
            this.dispatchEvent(facetEvent);
        } catch(ex) {
            console.error("Oops, bad value in .value? ", model.value, ": ", e);
        }
    },
});
