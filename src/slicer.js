/*
 * View model for OctoPrint-Slicer
 *
 * Author: Kenneth Jiang
 * License: AGPLv3
 */

'use strict';

import '../node_modules/babel-polyfill/dist/polyfill'
import * as THREE from 'three';
import * as THREETK from '3tk';
import { STLViewPort } from './STLViewPort';
import { OverridesViewModel } from './profile_overrides';
import { ModelArranger } from './ModelArranger';
import { ArrangeModels } from './ArrangeModels';
import { CheckerboardMaterial } from './CheckerboardMaterial';
import { find, forEach, endsWith, some, extend, map, isNaN } from 'lodash-es';
import { Chop } from './Chop';

function isDev() {
    return window.location.hostname == "localhost";
}

function SlicerViewModel(parameters) {
    mixpanel.track("App Loaded");

    var self = this;

    self.canvas = document.getElementById( 'slicer-canvas' );

    //check if webGL is present. If not disable Slicer plugin
    if ( ! THREETK.Detector.webgl ) {
        $('#tab_plugin_slicer').empty().append("<h3>Slicer Plugin is disabled because your browser doesn't support WebGL</h3>");
        return;
    }

    // assign the injected parameters, e.g.:
    self.slicingViewModel = parameters[0];
    self.overridesViewModel = parameters[1];
    self.printerStateViewModel = parameters[2];
    self.printerProfilesViewModel = parameters[3];
    self.filesViewModel = parameters[4];

    self.lockScale = true;

    self.modifierKeys = {ctrlKey: false,
                         shiftKey: false,
                         metaKey: false,
                         altKey: false};
    // Override slicingViewModel.show to surpress default slicing behavior
    self.slicingViewModel.show = function(target, file, force) {
        if (!self.slicingViewModel.enableSlicingDialog() && !force) {
            return;
        }
        mixpanel.track("Load STL");

        $('a[href="#tab_plugin_slicer"]').tab('show');

        self.setSlicingViewModelIfNeeded(target, file);
        self.addSTL(target, file);
    };

    self.resetToDefault = function() {
        self.resetSlicingViewModel();

        // hide all value inputs
        $("#slicer-viewport .values div").removeClass("show");
        updateTransformMode();
    }

    self.addSTL = function(target, file) {
        $('#tab_plugin_slicer > div.translucent-blocker').show();
        self.stlViewPort.loadSTL(
            BASEURL + "downloads/files/" + target + "/" + file,
            function (model) {
                model.userData.filename = file;
                self.setDestinationFilename()
                $('#tab_plugin_slicer > div.translucent-blocker').hide();
            });
    }

    self.onModelAdd = function(event) {

        var models = event.models;

        forEach( models, function( model ) {
            self.fixZPosition(model);
        });

        if (self.stlViewPort.models().length > 1) {
            new ModelArranger().arrange(self.stlViewPort.models());
        }
        updateValueInputs();
        updateControlState();
        $('#tab_plugin_slicer > div.translucent-blocker').hide();
    };

    self.onModelDelete = function() {
        if (self.stlViewPort.models().length == 0) {
            self.resetToDefault();
        }
        updateValueInputs();
        updateControlState();
        $('#tab_plugin_slicer > div.translucent-blocker').hide();
    };

    ko.computed(function() {
        var profileName = self.slicingViewModel.printerProfile();
        if (profileName) {
            var profile = find(self.printerProfilesViewModel.profiles.items(), function(p) {
                return p.id == profileName });

            var dim = profile.volume;
            self.BEDSIZE_X_MM = Math.max(dim.width, 0.1); // Safari will error if rectShape has dimensions being 0
            self.BEDSIZE_Y_MM = Math.max(dim.depth, 0.1);
            self.BEDSIZE_Z_MM = Math.max(dim.height, 0.1);
            self.BED_FORM_FACTOR = dim.formFactor;
            if (dim.origin == "lowerleft" ) {
                self.ORIGIN_OFFSET_X_MM = self.BEDSIZE_X_MM/2.0;
                self.ORIGIN_OFFSET_Y_MM = self.BEDSIZE_Y_MM/2.0;
            } else {
                self.ORIGIN_OFFSET_X_MM = 0;
                self.ORIGIN_OFFSET_Y_MM = 0;
            }
            self.stlViewPort.canvasWidth = self.BEDSIZE_X_MM;
            self.stlViewPort.canvasDepth = self.BEDSIZE_Y_MM;
            self.stlViewPort.canvasHeight = self.BEDSIZE_Z_MM;
            self.drawBedFloor(self.BEDSIZE_X_MM, self.BEDSIZE_Y_MM, self.BED_FORM_FACTOR);
            self.drawWalls(self.BEDSIZE_X_MM, self.BEDSIZE_Y_MM, self.BEDSIZE_Z_MM, self.BED_FORM_FACTOR);
            self.stlViewPort.resetCollisionDetector();
        }
    });

    self.slicing = ko.observable(false);

    self.BEDSIZE_X_MM = 200;
    self.BEDSIZE_Y_MM = 200;
    self.BEDSIZE_Z_MM = 200;
    self.BED_FORM_FACTOR = "rectangular";
    self.ORIGIN_OFFSET_X_MM = 0;
    self.ORIGIN_OFFSET_Y_MM = 0;

    var CANVAS_WIDTH = 588,
        CANVAS_DEPTH = 588,
        CANVAS_HEIGHT = 588;

    self.init = function() {
        OctoPrint.socket.onMessage("event", self.removeTempFilesAfterSlicing);
        $(document).on('keyup keydown', function(e) {
            self.modifierKeys = {ctrlKey: e.ctrlKey,
                                 shiftKey: e.shiftKey,
                                 altKey: e.altKey,
                                 metaKey: e.metaKey};
        });
        $('#tab_plugin_slicer > div.translucent-blocker').hide();

        self.slicingViewModel.requestData();

        self.stlViewPort = new STLViewPort(self.canvas, CANVAS_WIDTH, CANVAS_DEPTH, CANVAS_HEIGHT);
        self.stlViewPort.addEventListener( "change", self.onModelChange );
        self.stlViewPort.addEventListener( "add", self.onModelAdd );
        self.stlViewPort.addEventListener( "delete", self.onModelDelete );
        self.stlViewPort.init();

        //Walls and Floor
        self.walls = new THREE.Object3D();
        self.floor = new THREE.Object3D();
        self.origin= new THREE.Object3D();
        self.stlViewPort.scene.add(self.walls);
        self.stlViewPort.scene.add(self.floor);
        self.stlViewPort.scene.add(self.origin);

        // Chop
        self.chop = new Chop(self.stlViewPort);
        self.chop.addEventListener("offsetChange", self.onChopOffsetChange);

        ko.applyBindings(self.slicingViewModel, $('#slicing-settings')[0]);

        // Buttons on the canvas, and their behaviors.
        // TODO: it's not DRY. mix of prez code and logics. need to figure out a better way
        $("#slicer-viewport").empty().append('\
                  <div class="model">\
                    <button class="rotate disabled btn" title="Rotate"><img src="'
                        + PLUGIN_BASEURL
                        + 'slicer/static/img/rotate.png"></button>\
                    <button class="scale disabled btn" title="Scale"><img src="'
                        + PLUGIN_BASEURL
                        + 'slicer/static/img/scale.png"></button>\
                    <button class="chop disabled btn" title="Chop"><img src="'
                        + PLUGIN_BASEURL
                        + 'slicer/static/img/saw.png"></button>\
                    <button class="remove disabled btn" title="Remove"><img src="'
                        + PLUGIN_BASEURL
                        + 'slicer/static/img/remove.png"></button>\
                    <button class="removeall disabled btn" title="Remove all"><img src="'
                        + PLUGIN_BASEURL
                        + 'slicer/static/img/removeall.png"></button>\
                    <button class="arrange disabled btn" title="Arrange"><img src="'
                        + PLUGIN_BASEURL
                        + 'slicer/static/img/arrange.png"></button>\
                    <button class="more disabled btn" title="More..."><img src="'
                        + PLUGIN_BASEURL
                        + 'slicer/static/img/more.png"></button>\
                </div>\
                <div class="values rotate">\
                    <div>\
                        <a class="close"><i class="icon-remove-sign"></i></a>\
                        <p><span class="axis x">X</span><input type="number" step="any" name="x"><span title="">°</span></p>\
                        <p><span class="axis y">Y</span><input type="number" step="any" name="y"><span title="">°</span></p>\
                        <p><span class="axis z">Z</span><input type="number" step="any" name="z"><span title="">°</span></p>\
                        <p><button id="lay-flat" class="btn"><i class="icon-glass"></i><span>&nbsp;Lay flat</span></button></p>\
                        <p><button id="rotate0" class="btn"><i class="icon-fast-backward"></i><span>&nbsp;Reset</span></button></p>\
                        <span></span>\
                    </div>\
               </div>\
                <div class="values scale">\
                    <div>\
                        <a class="close"><i class="icon-remove-sign"></i></a>\
                        <p><span class="axis x">X</span><input type="number" step="0.001" name="x" min="0.001"><span class="size x" ></span></p>\
                        <p><span class="axis y">Y</span><input type="number" step="0.001" name="y" min="0.001"><span class="size y" ></span></p>\
                        <p><span class="axis z">Z</span><input type="number" step="0.001" name="z" min="0.001"><span class="size z" ></span></p>\
                        <p class="checkbox"><label><input id="lock-scale" type="checkbox" checked>Lock</label></p>\
                        <p class="checkbox"><label><input id="mirror-x" type="checkbox">Mirror X</label><label><input id="mirror-y" type="checkbox">Mirror Y</label></p>\
                        <span></span>\
                    </div>\
               </div>\
                <div class="values chop">\
                    <div>\
                        <a class="close"><img class="icon-remove-sign" /></a>\
                        <p><span class="axis">Offset</span><input type="number" step="0.1" id="chopOffsetMm" value=0>\
                           <span class="add-on">mm</span>\
                        <p><span class="axis">Offset%</span><input type="number" step="0.1" min="0" max="100" id="chopOffsetPercent" value=50>\
                           <span class="add-on">%</span>\
                        </p>\
                        <p><span class="axis x">X</span><input type="radio" name="chopAxis" value="x">\
                           <span class="axis y">Y</span><input type="radio" name="chopAxis" value="y">\
                           <span class="axis z">Z</span><input type="radio" name="chopAxis" value="z" checked>\
                        </p>\
                        <button class="btn" id="doChop">Chop it!</button>\
                        <span></span>\
                    </div>\
               </div>\
               <div class="values more">\
                   <div>\
                       <a class="close"><i class="icon-remove-sign"></i></a>\
                       <p><button id="split" class="btn"><i class="icon-unlink"></i><span>&nbsp;Split into parts</span></button></p>\
                       <p><button id="duplicate" class="btn"><i class="icon-copy"></i><span>&nbsp;Duplicate</span></button></p>\
                       <p><button id="info" class="btn"><i class="icon-info"></i><span>&nbsp;Advanced usage</span></button></p>\
                       <span></span>\
                   </div>\
               </div>');
        $("#slicer-viewport").append(self.stlViewPort.renderer.domElement);

        if ( isDev() ) {
            self.stlViewPort.stats = new Stats();
            self.stlViewPort.stats.showPanel( 1 );
            $("#slicer-viewport").append(self.stlViewPort.stats.dom);
        }

        $("#slicer-viewport button.rotate").click(function(event) {
            toggleValueInputs($("#slicer-viewport .rotate.values div"));
        });

        $("#slicer-viewport button.scale").click(function(event) {
            toggleValueInputs($("#slicer-viewport .scale.values div"));
        });

        $("#slicer-viewport button.chop").click(function(event) {
            toggleValueInputs($("#slicer-viewport .chop.values div"));
        });

        $("#doChop").click(function(event) {
            // Chop the curent model using the current plane.
            let originalFilename = self.stlViewPort.selectedModel().userData.filename;
            startLongRunning(() => { return self.stlViewPort.chopSelectedModel(self.chop.getPlane()); },
                             function (models) {
                                 if (models.length == 1) {
                                     models[0].userData.filename = originalFilename;
                                 } else {
                                     var partNumber = 1;
                                     for (var model of models) {
                                         model.userData.filename =
                                             originalFilename.substr(0, originalFilename.lastIndexOf(".")) +
                                             "_Chop" + partNumber +
                                             originalFilename.substr(originalFilename.lastIndexOf("."));
                                         partNumber++;
                                     }
                                 }
                                 self.setDestinationFilename();
                             });
            self.chop.stop();
            toggleValueInputs($("#slicer-viewport .chop.values div"));
        });

        $("#slicer-viewport button.remove").click(function(event) {
            self.stlViewPort.removeSelectedModel();
            self.setDestinationFilename();
        });

        $("#slicer-viewport button.arrange").click(function(event) {
            self.arrange(10 /* mm margin */, 5000 /* milliseconds max */);
        });

        $("#slicer-viewport button.more").click(function(event) {
            toggleValueInputs($("#slicer-viewport .more.values div"));
        });

        $("#slicer-viewport button.removeall").click(function(event) {
            self.stlViewPort.removeAllModels();
            self.resetToDefault();
            self.setDestinationFilename();
        });

        $("#slicer-viewport button#split").click(function(event) {
            toggleValueInputs($("#slicer-viewport .more.values div"));
            var originalFilename = self.stlViewPort.selectedModel().userData.filename;
            startLongRunning( self.stlViewPort.splitSelectedModel, function (models) {
                if (models.length == 1) {
                    models[0].userData.filename = originalFilename;
                } else {
                    var partNumber = 1;
                    for (var model of models) {
                        model.userData.filename =
                            originalFilename.substr(0, originalFilename.lastIndexOf(".")) +
                            "_Split" + partNumber +
                            originalFilename.substr(originalFilename.lastIndexOf("."));
                        partNumber++;
                    }
                }
                self.setDestinationFilename();
            });
        });

        $("#slicer-viewport button#duplicate").click(function(event) {
            toggleValueInputs($("#slicer-viewport .more.values div"));
            var copies = parseInt( prompt("The number of copies you want to duplicate:", 1) );
            if (!isNaN(copies)) {
                let originalFilename = self.stlViewPort.selectedModel().userData.filename;
                startLongRunning( self.stlViewPort.duplicateSelectedModel.bind(self, copies), function (models) {
                    forEach(models, function (model) {
                        model.userData.filename = originalFilename;
                    });
                    self.setDestinationFilename();
                });
            }
        });

        $("#slicer-viewport button#info").click(function(event) {
            toggleValueInputs($("#slicer-viewport .more.values div"));
            $("#plugin-slicer-advanced-usage-info").modal("show");
        });

        $("#slicer-viewport button#lay-flat").click(function(event) {
            $('#tab_plugin_slicer > div.translucent-blocker').show();
            self.stlViewPort.laySelectedModelFlat(function () {
                $('#tab_plugin_slicer > div.translucent-blocker').hide();
                self.stlViewPort.resetCollisionDetector();
            });
        });

        $("#slicer-viewport button#rotate0").click(function(event) {
            $("#slicer-viewport .rotate.values input").val(0);
            applyValueInputs($("#slicer-viewport .rotate.values input"));
        });

        $("#slicer-viewport .values input").on('input', function() {
            applyValueInputs($(this));
        });

        $("#slicer-viewport .values input#lock-scale").change( function(event) {
            self.lockScale = event.target.checked;
        });

        $("#slicer-viewport .values input[id^=mirror]").change( function(event) {
            applyMirrorScale(event.target);
        });

        $("#slicer-viewport .values input[type='radio']").change( function() {
            applyValueInputs($(this));
        });

        $("#slicer-viewport .values a.close").click(function() {
            $("#slicer-viewport .values div").removeClass("show");
            updateTransformMode();
        });
    };

    self.fixZPosition = function ( model ) {
        var bedLowMinZ = 0.0;
        var boundaryBox = model.userData.box3FromObject();
        boundaryBox.min.sub(model.position);
        boundaryBox.max.sub(model.position);
        model.position.z -= model.position.z + boundaryBox.min.z - bedLowMinZ;
    }

    self.arrangeModels = new ArrangeModels();
    self.arrange = function(margin, arrangeTime, forceStartOver = false) {
        var renderFn = function () {
            self.stlViewPort.onChange();
        }
        var endTime = performance.now() + arrangeTime;
        var TASK_SWITCH_MS = 500;
        $('#tab_plugin_slicer > div.translucent-blocker').show();
        var arrangeLoop = function() {
            setTimeout(function() {
                var done = self.arrangeModels.arrange(
                    self.stlViewPort.models(), self.BEDSIZE_X_MM, self.BEDSIZE_Y_MM,
                    margin, TASK_SWITCH_MS, renderFn, forceStartOver);
                if (!done && performance.now() < endTime) {
                    arrangeLoop();
                } else {
                    $('#tab_plugin_slicer > div.translucent-blocker').hide();
                    self.stlViewPort.resetCollisionDetector();
                }
            }, 0);
        };
        arrangeLoop();
    };

    // callback function when models are changed by TransformControls
    self.onModelChange = function() {
        var model = self.stlViewPort.selectedModel();
        if (model) self.fixZPosition(model);

        updateValueInputs();
        updateControlState();
    };

    self.onChopOffsetChange = function(e) {
        if (e.hasOwnProperty("axis")) {
            $("[name='chopAxis'][value='" + e.axis + "']")[0].checked = true;
        }
        if (e.hasOwnProperty("offsetMm")) {
            $("#chopOffsetMm").val(e.offsetMm.toFixed(1));
        }
        if (e.hasOwnProperty("offsetPercent")) {
            $("#chopOffsetPercent").val(e.offsetPercent.toFixed(1));
        }
        if (e.hasOwnProperty("offsetMmMax")) {
            $("#chopOffsetMm")[0].max = e.offsetMmMax;
        }
        if (e.hasOwnProperty("offsetMmMin")) {
            $("#chopOffsetMm")[0].min = e.offsetMmMin;
        }
    }

    // Slicing
    //
    self.tempFiles = {};
    self.removeTempFilesAfterSlicing = function (event) {
        if ($.inArray(event.data.type, ["SlicingDone", "SlicingFailed"]) >= 0 &&
            event.data.payload.stl in self.tempFiles) {
            OctoPrint.files.delete(event.data.payload.stl_location,
                event.data.payload.stl);
            delete self.tempFiles[event.data.payload.stl];
            self.slicing(false);
        }
    }

    self.sliceRequestData = function(slicingVM, groupCenter) {
        var destinationFilename = slicingVM._sanitize(slicingVM.destinationFilename());

        var destinationExtensions = slicingVM.data[slicingVM.slicer()] && slicingVM.data[slicingVM.slicer()].extensions && slicingVM.data[slicingVM.slicer()].extensions.destination
            ? slicingVM.data[slicingVM.slicer()].extensions.destination
            : ["???"];
        if (!some(destinationExtensions, function(extension) {
            return endsWith(destinationFilename.toLowerCase(), "." + extension.toLowerCase());
        })) {
            destinationFilename = destinationFilename + "." + destinationExtensions[0];
        }
        if (!groupCenter) {
            groupCenter = new THREE.Vector3(0,0,0);
        }
        var data = {
            command: "slice",
            slicer: slicingVM.slicer(),
            profile: slicingVM.profile(),
            printerProfile: slicingVM.printerProfile(),
            destination: destinationFilename,
            position: { "x": self.ORIGIN_OFFSET_X_MM + groupCenter.x,
                "y": self.ORIGIN_OFFSET_Y_MM + groupCenter.y}
        };
        extend(data, self.overridesViewModel.toJS());

        if (slicingVM.afterSlicing() == "print") {
            data["print"] = true;
        } else if (slicingVM.afterSlicing() == "select") {
            data["select"] = true;
        }
        return data;
    };

    self.sendSliceRequest = function(target, filename, data) {
        $.ajax({
            url: API_BASEURL + "files/" + target + "/" + filename,
            type: "POST",
            dataType: "json",
            contentType: "application/json; charset=UTF-8",
            data: JSON.stringify(data),
            error: function(jqXHR, textStatus) {
                new PNotify({title: "Slicing failed", text: jqXHR.responseText, type: "error", hide: false});
                self.slicing(false);
            }
        });
    };

    self.slice = function(ignoreCollisions = false) {
        mixpanel.track("Slice Model");
        self.slicing(true);

        $('#tab_plugin_slicer > div.translucent-blocker').show();
        var hasCollisions = self.stlViewPort.hasCollisions();
        $('#tab_plugin_slicer > div.translucent-blocker').hide();
        if (!ignoreCollisions && hasCollisions) {
            $("#plugin-slicer-slice-collisions").modal("show");
            return;
        }
        var target = self.slicingViewModel.target;
        var sliceRequestData;

        var form = new FormData();
        var group = new THREE.Group();
        let groupBox3 = new THREE.Box3();
        forEach(self.stlViewPort.models(), function (model) {
            group.add(model.clone(true));
            groupBox3.expandByPoint(model.userData.box3FromObject().min);
            groupBox3.expandByPoint(model.userData.box3FromObject().max);
        });

        sliceRequestData = self.sliceRequestData(self.slicingViewModel, groupBox3.getCenter());

        var tempFilename = self.tempSTLFilename();
        form.append("file", self.blobFromModel(group), tempFilename);
        $.ajax({
            url: API_BASEURL + "files/local",
            type: "POST",
            data: form,
            processData: false,
            contentType: false,
            // On success
            success: function(_) {
                self.tempFiles[tempFilename] = 1;
                self.sendSliceRequest(target, tempFilename, sliceRequestData);
            },
            error: function(jqXHR, textStatus) {
                new PNotify({title: "Slicing failed", text: jqXHR.responseText, type: "error", hide: false});
                self.slicing(false);
            }
        });
    };

    self.blobFromModel = function( model ) {
        var exporter = new THREETK.STLBinaryExporter();
        return new Blob([exporter.parse(model)], {type: "text/plain"});
    };

    // END: Slicing

    // Helpers for drawing walls and floor
    //
    self.createText = function(font, text, width, depth, parentObj) {
        var textGeometry = new THREE.TextGeometry( text, {
            font: font,
            size: 10,
            height: 0.1,
            material: 0, extrudeMaterial: 1
        });
        var materialFront = new THREE.MeshBasicMaterial( { color: 0x048e06} );
        var materialSide = new THREE.MeshBasicMaterial( { color: 0x8A8A8A} );
        var materialArray = [ materialFront, materialSide ];
        var textMaterial = materialArray;

        var mesh = new THREE.Mesh( textGeometry, textMaterial );
        textGeometry.computeBoundingBox();
        var textWidth = textGeometry.boundingBox.max.x - textGeometry.boundingBox.min.x;
        var textHeight = textGeometry.boundingBox.max.y - textGeometry.boundingBox.min.y;
        switch (text) {
            case "Front":
                mesh.position.set(-textWidth/2, -depth/2 - textHeight - 4, 1.0);
                break;
            case "Back":
                mesh.position.set(textWidth/2, depth/2 + textHeight + 4, 1.0);
                mesh.rotation.set(0, 0, Math.PI);
                break;
            case "Left":
                mesh.position.set(-width/2 - textHeight - 4, textWidth/2, 1.0);
                mesh.rotation.set(0, 0, -Math.PI / 2);
                break;
            case "Right":
                mesh.position.set(width/2 + textHeight, -textWidth/2, 1.0);
                mesh.rotation.set(0, 0, Math.PI / 2);
                break;
        }
        parentObj.add(mesh);
    };

    self.drawBedFloor = function ( width, depth, formFactor) {
        var geometry;
        for(var i = self.floor.children.length - 1; i >= 0; i--) {
            var obj = self.floor.children[i];
            self.floor.remove(obj);
        }

        if (formFactor == "circular") {
            geometry = new THREE.CircleGeometry(width/2, 60);
        } else {
            geometry = new THREE.PlaneBufferGeometry(width, depth);
        }
        var material = new CheckerboardMaterial(width/20, depth/20, null, function() { self.stlViewPort.render(); });  // 20mm/checker box
        var mesh = new THREE.Mesh(geometry, material);

        mesh.receiveShadow = true;
        self.floor.add(mesh);

        //Add text to indicate front/back of print bed
        var loader = new THREE.FontLoader();
        loader.load( PLUGIN_BASEURL + "slicer/static/js/optimer_bold.typeface.json", function ( font ) {
            self.createText(font, "Front", width, depth, self.floor);
            self.createText(font, "Back", width, depth, self.floor);
            self.createText(font, "Left", width, depth, self.floor);
            self.createText(font, "Right", width, depth, self.floor);
        } );

        self.drawOrigin();
    };

    self.drawOrigin = function() {
        for(var i = self.origin.children.length - 1; i >= 0; i--) {
            var obj = self.origin.children[i];
            self.origin.remove(obj);
        }

        var material = new THREE.LineBasicMaterial({
                color: 0x801010
        });

        const axisLength = 8;
        [[axisLength, 0, 0], [0, axisLength, 0], [0, 0, axisLength]].forEach( function(end) {
            const geometry = new THREE.Geometry();
            geometry.vertices.push(
                    new THREE.Vector3(0, 0, 0),
                    new THREE.Vector3(...end)
            );
            self.origin.add(new THREE.Line( geometry, material ));
        });

        self.origin.position.x = -self.ORIGIN_OFFSET_X_MM;
        self.origin.position.y = -self.ORIGIN_OFFSET_Y_MM;
    };

    self.drawWalls = function ( width, depth, height, formFactor ) {
        for(var i = self.walls.children.length - 1; i >= 0; i--) {
            var obj = self.walls.children[i];
            self.walls.remove(obj);
        }

        //This material will only make the inside of the cylinder walls visible while allowing the outside to be transparent.
        var wallMaterial = new THREE.MeshBasicMaterial({ color: 0x8888fc, side: THREE.BackSide, transparent: true, opacity: 0.8 });
        var invisibleMaterial = new THREE.MeshBasicMaterial({ visible: false, transparent: false });

        if (formFactor == "circular") {

            var cylGeometry = new THREE.CylinderGeometry(width/2, width/2, height, 60, 1, true);
            // Move the walls up to the floor
            cylGeometry.applyMatrix(new THREE.Matrix4().makeTranslation(0, height / 2, 0));
            var wall = new THREE.Mesh(cylGeometry, wallMaterial);
            //rotate the walls so they are upright
            wall.rotation.x = Math.PI / 2;
            self.walls.add(wall);

        } else  {

            var cubeGeometry = new THREE.BoxBufferGeometry( width, depth, height );
            var materials = [
                    wallMaterial,
                    wallMaterial,
                    wallMaterial,
                    wallMaterial,
                    invisibleMaterial,
                    invisibleMaterial,
            ];
            var cubeSidesMaterial = materials;
            var wall = new THREE.Mesh( cubeGeometry, cubeSidesMaterial );
            wall.position.z = height/2;
            self.walls.add(wall);

        }
    };

    // END: Helpers for drawing walls and floor

    self.resetSlicingViewModel = function() {
        self.slicingViewModel.target = undefined;
        self.slicingViewModel.file(undefined);
        self.slicingViewModel.destinationFilename(undefined);
    };

    self.setSlicingViewModelIfNeeded = function(target, filename) {
        self.slicingViewModel.target = target;
        self.slicingViewModel.file(filename);
    };

    let previousDestinationFilename = "";
    self.setDestinationFilename = function() {
        if (!self.slicingViewModel.destinationFilename() ||
            self.slicingViewModel.destinationFilename() == previousDestinationFilename) {
            // No previous destination filename or it was unchanged.
            let filenames = map(self.stlViewPort.models(), function (model) {
                return model.userData.filename;
            });
            previousDestinationFilename = self.computeDestinationFilename(filenames);
            self.slicingViewModel.destinationFilename(previousDestinationFilename);
        }
    }

    // Returns the destination filename based on which models are loaded.
    // The destination filename is without the final .gco on it because
    // that will depend on the slicer.
    self.computeDestinationFilename = function(inputFilenames) {
        if (inputFilenames.length == 0) {
            return "";
        }
        // First, sanitize the filenames to extract the file name.
        var destFilenames = map(inputFilenames, function(inputFilename) {
            let destFilename = inputFilename.substr(0, inputFilename.lastIndexOf("."));
            if (destFilename.lastIndexOf("/") != 0) {
                destFilename = destFilename.substr(destFilename.lastIndexOf("/") + 1);
            }
            return destFilename;
        });

        // Find the common prefix.
        let first = destFilenames[0];
        let last = destFilenames[0];
        for (let destFilename of destFilenames) {
            if (destFilename < first) {
                first = destFilename;
            }
            if (destFilename > last) {
                last = destFilename;
            }
        }
        if (first == last) {
            // 1 or more of the same file.
            if (destFilenames.length == 1) {
                // Just one file.
                return destFilenames[0];
            } else {
                // More than 1 of the same file.
                return destFilenames[0] + "x" + destFilenames.length;
            }
        }
        let commonPrefixLength = 0;
        while (first[commonPrefixLength] == last[commonPrefixLength] && commonPrefixLength <= first.length) {
            commonPrefixLength++;
        }
        if (commonPrefixLength > 2) {
            // If the common prefix is significant in length, use it.
            return first.slice(0, commonPrefixLength) + "_Various";
        }
        return destFilenames[0];  // Default, return the first file.
    };

    self.tempSTLFilename = function() {
        var pos = self.slicingViewModel.file().lastIndexOf(".")
        return [self.slicingViewModel.file().slice(0, pos),
            ".tmp." + (+ new Date()),
            self.slicingViewModel.file().slice(pos)].join('');
    };

    // Pause WebGL rendering when slicer tab is inactive
    self.onTabChange = function (next, current) {
        if (current === "#tab_plugin_slicer") {
            self.stlViewPort.pauseRendering();
        }
    }
    self.onAfterTabChange = function (current, previous) {
        if (current === "#tab_plugin_slicer") {
            self.stlViewPort.unpauseRendering();
        }
    }

    self.init();

    //////////////////////
    // internal functions
    ///////////////////////

    function startLongRunning( func, callback ) {
        $('#tab_plugin_slicer > div.translucent-blocker').show();
        setTimeout( function() {
            let result = func();
            $('#tab_plugin_slicer > div.translucent-blocker').hide();
            callback(result);
        }, 25);
    }

    function updateTransformMode() {
        self.chop.stop();
        self.stlViewPort.setCursorControl(true);
        if ( $("#slicer-viewport .rotate.values div").hasClass("show") ) {
            self.stlViewPort.transformControls.setMode("rotate");
            self.stlViewPort.transformControls.space = "world";
        } else if ( $("#slicer-viewport .scale.values div").hasClass("show") ) {
            self.stlViewPort.transformControls.setMode("scale");
            self.stlViewPort.transformControls.space = "local";
            self.stlViewPort.transformControls.axis = null;
        } else if ( $("#slicer-viewport .chop.values div").hasClass("show") ) {
            self.stlViewPort.transformControls.setMode("scale");
            self.stlViewPort.transformControls.space = "local";
            self.stlViewPort.transformControls.axis = null;
            self.chop.start(self.stlViewPort.selectedModel());
            self.stlViewPort.setCursorControl(false);
            applyChopInputs();
        } else {
            self.stlViewPort.transformControls.setMode("translate");
            self.stlViewPort.transformControls.space = "world";
            self.stlViewPort.transformControls.axis = "XY";
        }
    }


    // Value inputs

    function updateSizeInfo() {
        var model = self.stlViewPort.selectedModel();
        if (model) {
            var size = model.userData.box3FromObject().getSize();
            $("#slicer-viewport > div.values.scale > div > p > span.size.x").text(size.x.toFixed(1) + "mm");
            $("#slicer-viewport > div.values.scale > div > p > span.size.y").text(size.y.toFixed(1) + "mm");
            $("#slicer-viewport > div.values.scale > div > p > span.size.z").text(size.z.toFixed(1) + "mm");
        }
    }

    function updateMirrorCheckboxes() {
        var model = self.stlViewPort.selectedModel();
        $("#slicer-viewport .scale.values input#mirror-x").prop('checked', model.scale.x < 0);
        $("#slicer-viewport .scale.values input#mirror-y").prop('checked',model.scale.y < 0);
    }

    function updateValueInputs() {
        var model = self.stlViewPort.selectedModel();
        if (model) {
            $("#slicer-viewport .rotate.values input[name=\"x\"]").val((model.rotation.x * 180 / Math.PI).toFixed(1)).attr("min", '');
            $("#slicer-viewport .rotate.values input[name=\"y\"]").val((model.rotation.y * 180 / Math.PI).toFixed(1)).attr("min", '');
            $("#slicer-viewport .rotate.values input[name=\"z\"]").val((model.rotation.z * 180 / Math.PI).toFixed(1)).attr("min", '');
            $("#slicer-viewport .scale.values input[name=\"x\"]").val(model.scale.x.toFixed(3)).attr("min", '');
            $("#slicer-viewport .scale.values input[name=\"y\"]").val(model.scale.y.toFixed(3)).attr("min", '');
            $("#slicer-viewport .scale.values input[name=\"z\"]").val(model.scale.z.toFixed(3)).attr("min", '');
            $("#slicer-viewport .scale.values input#lock-scale").checked = self.lockScale;

            updateSizeInfo();
            updateMirrorCheckboxes();
        }
    }

    function updateControlState() {
        if (!self.stlViewPort.selectedModel()) {
            $("#slicer-viewport button").addClass("disabled");
            $("#slicer-viewport .values div").removeClass("show");
            updateTransformMode();
        } else {
            $("#slicer-viewport button").removeClass("disabled");
        }
    }

    function toggleValueInputs(parentDiv) {
        if ( parentDiv.hasClass("show") ) {
            $("#slicer-viewport .values div").removeClass("show");
        } else if (self.stlViewPort.selectedModel()) {
            $("#slicer-viewport .values div").removeClass("show");
            parentDiv.addClass("show").children('p').addClass("show");
        }
        updateTransformMode();
    }

    function applyChopInputs(input) {
        if (!input) {
            self.chop.setAxis($("[name='chopAxis']:checked").val());
        } else if (input[0].id == "chopOffsetMm") {
            self.chop.setOffsetMm(parseFloat($("#chopOffsetMm").val()));
        } else if (input[0].id == "chopOffsetPercent" && !Number.isNaN(parseFloat($("#chopOffsetPercent").val()))) {
            self.chop.setOffsetPercent(parseFloat($("#chopOffsetPercent").val()));
        } else if (input[0].name == "chopAxis") {
            self.chop.setAxis($("[name='chopAxis']:checked").val());
        }
    }

    function applyValueInputs(input) {
        if(input[0].type == "checkbox" && input[0].id == "lock-scale") {
            self.lockScale = input[0].checked;
        }
        else if(input[0].type == "number" && !isNaN(parseFloat(input.val()))) {
            var model = self.stlViewPort.selectedModel();
            if (model === undefined) return;

            if (input.closest(".values").hasClass("scale") && self.lockScale) {
                // Updating self in event handler will cost a lot of weirdness in user experience
                // Therefore this very convoluted way to do "update all other scale fields except myself".
                $("#slicer-viewport .scale.values input").each( function(i, ele) {
                    if (ele.type == "number" && ele !== input[0]) {
                        $(ele).val(input.val());
                    }
                });
            }

            model.rotation.x =  THREE.Math.degToRad($("#slicer-viewport .rotate.values input[name=\"x\"]").val());
            model.rotation.y =  THREE.Math.degToRad($("#slicer-viewport .rotate.values input[name=\"y\"]").val());
            model.rotation.z =  THREE.Math.degToRad($("#slicer-viewport .rotate.values input[name=\"z\"]").val());
            model.scale.x =  parseFloat($("#slicer-viewport .scale.values input[name=\"x\"]").val())
            model.scale.y =  parseFloat($("#slicer-viewport .scale.values input[name=\"y\"]").val())
            model.scale.z =  parseFloat($("#slicer-viewport .scale.values input[name=\"z\"]").val())

            self.fixZPosition(model);
            updateSizeInfo();
            updateMirrorCheckboxes();
            self.stlViewPort.recalculateOverhang(model);
            self.stlViewPort.resetCollisionDetector();
        }
        if (input[0].name == "chopAxis" ||
            input[0].id == "chopOffsetMm" ||
            input[0].id == "chopOffsetPercent") {
            applyChopInputs(input);
        }
    }

    function applyMirrorScale(mirrorCheckbox) {
        var model = self.stlViewPort.selectedModel();
        if (mirrorCheckbox.id == "mirror-x") {
            model.scale.x = -1 * model.scale.x;
        }
        if (mirrorCheckbox.id == "mirror-y") {
            model.scale.y = -1 * model.scale.y;
        }
        if (mirrorCheckbox.checked) {
            self.lockScale = false;
        }

        updateValueInputs();
    }

}


// view model class, parameters for constructor, container to bind to
OCTOPRINT_VIEWMODELS.push([
    SlicerViewModel,

    // e.g. loginStateViewModel, settingsViewModel, ...
    [ "slicingViewModel", "overridesViewModel", "printerStateViewModel", "printerProfilesViewModel", "filesViewModel" ],

    // e.g. #settings_plugin_slicer, #tab_plugin_slicer, ...
    [ "#slicer" ]
]);
