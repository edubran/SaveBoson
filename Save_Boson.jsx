/**
 * Boson Save - Project Manager for After Effects
 * Version: 4.0
 * 
 * Author: Eduardo Brandao - eduardo@bosonpost.com.br
 * 
 * This script implements a panel for project management in After Effects,
 * including standardized naming on save, version navigation, placeholder
 * replacement, and layer operations.
 *
 * Changelog v4.0:
 * - [FEATURE] Full-path versioning: _v### tokens in folder segments are now
 *             replaced alongside the filename (e.g. /proj/v003/shot_v003.exr
 *             becomes /proj/v004/shot_v004.exr)
 * - [FEATURE] Version boundary alert: silent on success, single alert only
 *             when the item has no further version in that direction
 *
 * Changelog v3.9:
 * - [FIX] Boundary alert collected per-item instead of firing mid-loop
 *
 * Changelog v3.8:
 * - [FIX] Recent folders now read fresh from disk on every click
 *
 * Changelog v3.1:
 * - [FIX] successCount in recursive version ops was always 0 (result - count after count = result)
 * - [FIX] Dead code removed: savedItems in replaceVersionFileUp/Down was never used
 * - [FIX] checkCompatibility now parses AE version string correctly (major.minor split)
 * - [FIX] findMenuCommandId("Deselect All") cached outside loop in processSelectedLayers
 * - [FIX] saveProject no longer references removed artist field
 * - [CHANGE] Artist field removed from UI and filename convention
 * - [CHANGE] Favorites / Recent Folders system added (max 5 entries)
 * - [CHANGE] All UI strings in English
 */

// Main namespace
var BosonSave = (function () {

    // -------------------------------------------------------------------------
    // Private state
    // -------------------------------------------------------------------------
    var _settings = {
        lastFolder:     null,
        recentFolders:  [],          // max MAX_RECENT entries
        defaultVersion: "v001",
        defaultWidth:   1920,
        defaultHeight:  1080,
        defaultFps:     24
    };

    var MAX_RECENT = 5;

    // UI element references
    var _ui = {
        mainWindow:       null,
        folderButton:     null,
        favButton:        null,
        folderPathText:   null,
        saveButton:       null,
        versionUpButton:  null,
        versionDownButton:null,
        maskItButton:     null,
        editItButton:     null,
        placeHoldButton:  null,
        nameField:        null,
        typeField:        null,
        versionField:     null
    };

    // -------------------------------------------------------------------------
    // VersionUtils — file version helpers
    //
    // Full-path versioning strategy:
    //   Pipeline paths often contain version tokens in folder segments too,
    //   e.g. /project/v003/shots/v003/shot_comp_v003.exr
    //   When versioning, ALL _v### tokens in the full path are replaced,
    //   not just the filename — matching the behaviour of tools like VersionUp.
    //
    //   Detection priority:
    //     1. _v### (3-digit pipeline standard) anywhere in filename
    //     2. Legacy: 2-digit number immediately before extension
    // -------------------------------------------------------------------------
    var VersionUtils = {

        // Regex used throughout — defined once for consistency
        PIPELINE_RE: /_v(\d+)/gi,   // matches _v001, _v01, _v1 etc. in any segment
        FILE_RE_3:   /_v(\d{3})(?=\.\w+$)/i,
        FILE_RE_2:   /(\d{2})(?=\.\w+$)/,

        /**
         * Extracts version info from a File object.
         * Also inspects the full fsName so path-level version tokens are captured.
         *
         * Returns:
         *   fsName          — full original path (forward slashes)
         *   fileName        — bare filename
         *   baseName        — filename without version token and extension
         *   extension       — ".exr", ".aep" etc.
         *   versionNumber   — string like "003" or "01"
         *   versionInt      — parsed integer
         *   isPipelineNaming — true if _v### token found in filename
         *   pathHasVersion  — true if any folder segment also contains _v###
         */
        getFileInfo: function (file) {
            var fsName    = file.fsName.replace(/\\/g, "/");
            var fileName  = file.name;
            var extension = "." + fileName.split(".").pop();

            var versionNumber, baseName, isPipeline;

            // 1. Pipeline naming: _v### in filename
            var m3 = fileName.match(this.FILE_RE_3);
            if (m3) {
                versionNumber = m3[1];
                baseName      = fileName.replace("_v" + versionNumber + extension, "");
                isPipeline    = true;
            } else {
                // 2. Legacy: 2-digit number before extension
                var m2 = fileName.match(this.FILE_RE_2);
                versionNumber = m2 ? m2[1] : "01";
                baseName      = fileName.replace(versionNumber + extension, "");
                isPipeline    = false;
            }

            // Check whether any folder segment in the path also has a _v### token
            // (excluding the filename itself — we only care about folder segments)
            var dirPart       = fsName.substring(0, fsName.lastIndexOf("/"));
            var pathHasVersion = /_v\d+/i.test(dirPart);

            return {
                fsName:           fsName,
                path:             file.path,
                name:             fileName,
                baseName:         baseName,
                versionNumber:    versionNumber,
                versionInt:       parseInt(versionNumber, 10),
                extension:        extension,
                isPipelineNaming: isPipeline,
                pathHasVersion:   pathHasVersion
            };
        },

        /**
         * Replaces ALL _v### tokens in a full path string with the given version.
         * Used when pathHasVersion is true so folder segments update together
         * with the filename.
         *
         * Example:
         *   replaceVersionInPath("/proj/v003/shots/shot_v003.exr", "003", "004")
         *   → "/proj/v004/shots/shot_v004.exr"
         *
         * @param {String} fsName        — full path, forward slashes
         * @param {String} currentVerStr — e.g. "003"
         * @param {String} newVerStr     — e.g. "004"
         * @return {String}
         */
        replaceVersionInPath: function (fsName, currentVerStr, newVerStr) {
            // Replace _v<currentVer> with _v<newVer> globally, case-insensitive
            // Use a function replacement so we preserve the original case of "v"
            var pattern = new RegExp("(_v)" + currentVerStr, "gi");
            return fsName.replace(pattern, function (match, prefix) {
                return prefix + newVerStr;
            });
        },

        /**
         * Builds the new file path for a given target version.
         * Handles both pipeline (full-path replacement) and legacy (filename only).
         *
         * @param {Object} fileInfo    — from getFileInfo
         * @param {Number} targetVer   — integer version number
         * @return {String}            — full path to the target file
         */
        buildNewPath: function (fileInfo, targetVer) {
            var formatted = this.formatVersion(targetVer, fileInfo.isPipelineNaming);

            if (fileInfo.isPipelineNaming && fileInfo.pathHasVersion) {
                // Replace version tokens everywhere in the full path
                return this.replaceVersionInPath(fileInfo.fsName, fileInfo.versionNumber, formatted);
            } else if (fileInfo.isPipelineNaming) {
                // Only filename has the token
                return fileInfo.path.replace(/\\/g, "/") + "/" +
                       fileInfo.baseName + "_v" + formatted + fileInfo.extension;
            } else {
                // Legacy 2-digit
                return fileInfo.path.replace(/\\/g, "/") + "/" +
                       fileInfo.baseName + formatted + fileInfo.extension;
            }
        },

        /**
         * Returns all numeric versions found on disk for this file's base name.
         * When pathHasVersion is true, searches the parent folder after replacing
         * the path-level version token too — so it finds siblings across folder versions.
         *
         * @param {Object} fileInfo
         * @return {Array.<Number>}
         */
        findAvailableVersions: function (fileInfo) {
            var versions = [];

            if (fileInfo.isPipelineNaming && fileInfo.pathHasVersion) {
                // We need to search across versioned folder siblings.
                // Strategy: enumerate possible version numbers by scanning what
                // exists on disk. We test a wide range (1..999) and check existence.
                // This avoids needing glob patterns across directory levels.
                var cur = fileInfo.versionInt;
                var lo  = Math.max(1, cur - 50);
                var hi  = cur + 50;
                for (var v = lo; v <= hi; v++) {
                    var formatted = this.formatVersion(v, true);
                    var testPath  = this.replaceVersionInPath(fileInfo.fsName, fileInfo.versionNumber, formatted);
                    if (new File(testPath).exists) {
                        versions.push(v);
                    }
                }
            } else {
                // Single-folder search — fast glob
                var folder  = new Folder(fileInfo.path);
                var pattern = fileInfo.isPipelineNaming
                    ? fileInfo.baseName + "_v???" + fileInfo.extension
                    : fileInfo.baseName + "??"    + fileInfo.extension;
                var files = folder.getFiles(pattern);
                for (var i = 0; i < files.length; i++) {
                    var m = fileInfo.isPipelineNaming
                        ? files[i].name.match(/_v(\d{3})(?=\.\w+$)/i)
                        : files[i].name.match(/(\d{2})(?=\.\w+$)/);
                    if (m) versions.push(parseInt(m[1], 10));
                }
            }

            versions.sort(function (a, b) { return a - b; });
            return versions;
        },

        /**
         * Finds the next higher or lower version from the sorted list.
         * @param {Array.<Number>} versions
         * @param {Number}  currentVersionInt
         * @param {Boolean} goUp
         * @return {Number|null}
         */
        findNextVersion: function (versions, currentVersionInt, goUp) {
            if (versions.length === 0) return null;
            var cur = parseInt(currentVersionInt, 10);

            if (goUp) {
                for (var i = 0; i < versions.length; i++) {
                    if (versions[i] > cur) return versions[i];
                }
            } else {
                for (var i = versions.length - 1; i >= 0; i--) {
                    if (versions[i] < cur) return versions[i];
                }
            }
            return null;
        },

        /**
         * Zero-pads a version integer to the correct width.
         * Pipeline: 3 digits. Legacy: 2 digits.
         * @param {Number}  version
         * @param {Boolean} isPipelineNaming
         * @return {String}
         */
        formatVersion: function (version, isPipelineNaming) {
            return isPipelineNaming
                ? ("00"  + version).slice(-3)
                : ("0"   + version).slice(-2);
        }
    };

    // -------------------------------------------------------------------------
    // UIUtils — generic UI helpers
    // -------------------------------------------------------------------------
    var UIUtils = {
        showProgress: function (title, message, total) {
            var w   = new Window("palette", title, undefined, {closeButton: false});
            var bar = w.add("progressbar", undefined, 0, total);
            bar.preferredSize.width = 300;
            var txt = w.add("statictext", undefined, message);
            txt.preferredSize.width = 300;
            w.show();
            w.update();
            return {
                update: function (current, newMessage) {
                    bar.value = current;
                    if (newMessage) txt.text = newMessage;
                    w.update();
                },
                close: function () { w.close(); }
            };
        },

        confirm: function (message, title) {
            return confirm(message, title || "Confirm", true);
        },

        alert: function (message, title) {
            alert(message, title || "Alert", false);
        }
    };

    // -------------------------------------------------------------------------
    // ErrorUtils — standardised error handling
    // -------------------------------------------------------------------------
    var ErrorUtils = {
        handleError: function (type, message) {
            UIUtils.alert("[" + type + "] " + message, "Error");
            $.writeln("[ERROR][" + type + "] " + message);
        },

        tryCatch: function (func, errorType, args) {
            try {
                return func.apply(null, args || []);
            } catch (e) {
                this.handleError(errorType, e.message);
                return undefined;
            }
        }
    };

    // -------------------------------------------------------------------------
    // SettingsUtils — dual-layer persistence
    //
    // PRIMARY:   app.settings (AE's own preference store)
    //            — always available, no file-write permission needed,
    //              survives AE restarts automatically.
    //
    // SECONDARY: JSON file in Folder.userData
    //            — used as fallback / migration source only when
    //              "Allow Scripts to Write Files" is enabled in AE prefs.
    //
    // On every save we write to app.settings first, then attempt the JSON
    // file as a bonus. On load we read app.settings first; if empty we try
    // to migrate from the JSON file (handles upgrades from v3.0/3.1).
    // -------------------------------------------------------------------------
    var SettingsUtils = {
        _SECTION: "BosonSave",        // app.settings section name
        _KEY:     "settings_v1",      // single key — full JSON blob
        _jsonPath: function () {
            return Folder.userData.fsName + "/BosonSave_settings.json";
        },

        /**
         * Validates and migrates a raw parsed object, filling missing fields
         * and stripping obsolete ones (e.g. defaultArtist from v3.0).
         */
        _sanitize: function (obj) {
            if (typeof obj !== "object" || obj === null) return null;

            // lastFolder
            if (!obj.hasOwnProperty("lastFolder") || typeof obj.lastFolder !== "string") {
                obj.lastFolder = null;
            }

            // recentFolders — use duck-typing instead of instanceof/toString to avoid context bugs
            if (!obj.hasOwnProperty("recentFolders") || typeof obj.recentFolders !== "object" ||
                obj.recentFolders === null || typeof obj.recentFolders.length === "undefined") {
                obj.recentFolders = [];
            }

            // defaultVersion — fix corrupted values like "\001" from old saves
            if (!obj.hasOwnProperty("defaultVersion") || typeof obj.defaultVersion !== "string" ||
                obj.defaultVersion.length === 0 || obj.defaultVersion.charAt(0) !== "v") {
                obj.defaultVersion = "v001";
            }

            if (!obj.hasOwnProperty("defaultWidth")  || isNaN(obj.defaultWidth))  obj.defaultWidth  = 1920;
            if (!obj.hasOwnProperty("defaultHeight") || isNaN(obj.defaultHeight)) obj.defaultHeight = 1080;
            if (!obj.hasOwnProperty("defaultFps")    || isNaN(obj.defaultFps))    obj.defaultFps    = 24;

            // Remove obsolete keys (e.g. defaultArtist from v3.0)
            var validKeys = {
                lastFolder: 1, recentFolders: 1, defaultVersion: 1,
                defaultWidth: 1, defaultHeight: 1, defaultFps: 1
            };
            for (var k in obj) {
                if (obj.hasOwnProperty(k) && !validKeys.hasOwnProperty(k)) {
                    delete obj[k];
                }
            }
            return obj;
        },

        saveSettings: function (settings) {
            var json = JSON.stringify(settings);

            // PRIMARY: JSON file — explicit UTF-8, confirmed working on this machine
            try {
                var f = new File(this._jsonPath());
                f.encoding = "UTF-8";
                if (f.open("w")) {
                    f.write(json);
                    f.close();
                }
            } catch (e) {
                $.writeln("[Settings] JSON file write failed: " + e.message);
            }

            // SECONDARY: app.settings — extra persistence layer
            try {
                app.settings.saveSetting(this._SECTION, this._KEY, json);
            } catch (e) {
                $.writeln("[Settings] app.settings write failed: " + e.message);
            }
        },

        loadSettings: function () {
            // 1. JSON file — explicit UTF-8 encoding, primary source of truth
            try {
                var f = new File(this._jsonPath());
                if (f.exists) {
                    f.encoding = "UTF-8";
                    if (f.open("r")) {
                        var content = f.read();
                        f.close();
                        if (content && content.length > 0) {
                            var parsed = JSON.parse(content);
                            var result = this._sanitize(parsed);
                            if (result) return result;
                        }
                    }
                }
            } catch (e) {
                $.writeln("[Settings] JSON file read failed: " + e.message);
            }

            // 2. app.settings fallback
            try {
                if (app.settings.haveSetting(this._SECTION, this._KEY)) {
                    var raw = app.settings.getSetting(this._SECTION, this._KEY);
                    if (raw && raw.length > 0) {
                        var parsedAlt = JSON.parse(raw);
                        return this._sanitize(parsedAlt);
                    }
                }
            } catch (e) {
                $.writeln("[Settings] app.settings read failed: " + e.message);
            }

            return null;
        }
    };

    // -------------------------------------------------------------------------
    // FolderFavorites — recent/favorite folder management
    // -------------------------------------------------------------------------
    var FolderFavorites = {
        /**
         * Adds a folder path to the recent list (deduped, capped at MAX_RECENT).
         * @param {String} fsName
         */
        add: function (fsName) {
            var list = (Object.prototype.toString.call(_settings.recentFolders) === "[object Array]")
                ? _settings.recentFolders : [];
            // Remove existing entry if present (move-to-front)
            for (var i = list.length - 1; i >= 0; i--) {
                if (list[i] === fsName) list.splice(i, 1);
            }
            list.unshift(fsName);
            if (list.length > MAX_RECENT) list.length = MAX_RECENT;
            _settings.recentFolders = list;
        },

        /**
         * Opens a custom picker window showing recent folders + Browse option.
         * Returns selected fsName string, or null if cancelled.
         * @return {String|null}
         */
        pick: function () {
            var list = (Object.prototype.toString.call(_settings.recentFolders) === "[object Array]")
                ? _settings.recentFolders : [];

            // Build display labels: show last 4 segments so the project root is visible
            var items = [];
            for (var i = 0; i < list.length; i++) {
                var parts = list[i].replace(/\\/g, "/").split("/");
                var label;
                if (parts.length <= 4) {
                    label = list[i].replace(/\\/g, "/");
                } else {
                    label = ".../" + parts.slice(-4).join("/");
                }
                items.push(label);
            }

            var dlg = new Window("dialog", "Select Folder");
            dlg.alignChildren = "fill";

            dlg.add("statictext", undefined, "Recent Folders:");

            var lb = dlg.add("listbox", undefined, items);
            lb.preferredSize = [460, 130];

            // Full path readout — updates on selection change
            var pathLabel = dlg.add("statictext", undefined, "Select a folder above to see its full path.");
            pathLabel.preferredSize = [460, 18];

            lb.onChange = function () {
                if (lb.selection) {
                    pathLabel.text = list[lb.selection.index];
                } else {
                    pathLabel.text = "Select a folder above to see its full path.";
                }
            };

            var btnGroup = dlg.add("group");
            btnGroup.alignment = "fill";
            btnGroup.alignChildren = "fill";

            var browseBtn = btnGroup.add("button", undefined, "Browse...");
            var useBtn    = btnGroup.add("button", undefined, "Use Selected");
            var cancelBtn = btnGroup.add("button", undefined, "Cancel");
            browseBtn.preferredSize = useBtn.preferredSize = cancelBtn.preferredSize = [148, 28];

            var result = null;

            browseBtn.onClick = function () {
                result = "__browse__";
                dlg.close(0);
            };

            useBtn.onClick = function () {
                if (!lb.selection) {
                    UIUtils.alert("Please select a folder from the list first.");
                    return;
                }
                result = list[lb.selection.index];
                dlg.close(1);
            };

            cancelBtn.onClick = function () {
                result = null;
                dlg.close(2);
            };

            lb.onDoubleClick = function () {
                if (lb.selection) {
                    result = list[lb.selection.index];
                    dlg.close(1);
                }
            };

            dlg.show();
            return result;
        }
    };

    // -------------------------------------------------------------------------
    // FileOps — folder selection and project save
    // -------------------------------------------------------------------------
    var FileOps = {
        /**
         * Selects a folder either from recents or via native OS dialog.
         * Updates _settings.lastFolder and persists.
         * @return {Folder|null}
         */
        selectFolder: function () {
            var list = (Object.prototype.toString.call(_settings.recentFolders) === "[object Array]")
                ? _settings.recentFolders : [];
            var chosen = null;

            if (list.length > 0) {
                var pick = FolderFavorites.pick();

                if (pick === "__browse__" || pick === null) {
                    // Open native dialog
                    if (pick === "__browse__") {
                        var f = Folder.selectDialog("Select project folder");
                        if (f) chosen = f.fsName;
                    }
                    // else: cancelled — chosen stays null
                } else {
                    chosen = pick;
                }
            } else {
                // No recents yet — go straight to native dialog
                var f = Folder.selectDialog("Select project folder");
                if (f) chosen = f.fsName;
            }

            if (chosen) {
                _settings.lastFolder = chosen;
                FolderFavorites.add(chosen);
                SettingsUtils.saveSettings(_settings);

                // Update path label in UI
                if (_ui.folderPathText) {
                    var parts = chosen.replace(/\\/g, "/").split("/");
                    _ui.folderPathText.text = (parts.length > 2)
                        ? "..." + "/" + parts[parts.length - 2] + "/" + parts[parts.length - 1]
                        : chosen;
                    if (_ui.mainWindow) _ui.mainWindow.layout.layout(true);
                }

                return new Folder(chosen);
            }
            return null;
        },

        /**
         * Saves the AE project with a standardised filename.
         * Filename pattern: {name}_{type}_{version}.aep
         * Artist field has been intentionally removed from the naming convention.
         * @param {String} folder
         * @param {String} name
         * @param {String} type
         * @param {String} version
         * @return {Boolean}
         */
        saveProject: function (folder, name, type, version) {
            if (!folder) {
                UIUtils.alert("Please select a folder first.", "No Folder");
                return false;
            }
            if (!name) {
                UIUtils.alert("Please enter a project name.", "No Name");
                return false;
            }

            var parts    = [name];
            if (type)    parts.push(type);
            if (version) parts.push(version);
            var fileName = parts.join("_") + ".aep";
            var filePath = folder + "/" + fileName;

            if (UIUtils.confirm("Save project as:\n" + filePath, "Confirm Save")) {
                try {
                    app.project.save(new File(filePath));
                    SettingsUtils.saveSettings(_settings);
                    return true;
                } catch (e) {
                    ErrorUtils.handleError("SaveProject", "Could not save project: " + e.message);
                }
            }
            return false;
        }
    };

    // -------------------------------------------------------------------------
    // VersionOps — version up / version down on project panel items
    // -------------------------------------------------------------------------
    var VersionOps = {

        /**
         * Core recursive worker. Processes an array of project items,
         * replacing each FootageItem source with the next higher/lower version
         * found on disk.
         *
         * BUG FIX: previous code did `count = result; successCount += (result - count)`
         * which always added 0. Now the function returns {count, successCount} so
         * recursive calls can accumulate both correctly.
         *
         * @param {Array}   itemsArr
         * @param {Boolean} goUp      — true = version up, false = version down
         * @param {Object}  progress  — UIUtils progress object (passed from public runner)
         * @param {Number}  totalCount — used only for progress bar denominator
         * @return {{count: Number, successCount: Number}}
         */
        _processItems: function (itemsArr, goUp, progress, totalCount, boundaryItems) {
            var count = 0, successCount = 0;
            // boundaryItems is passed by reference from run() to accumulate across recursion
            if (!boundaryItems) boundaryItems = [];

            for (var i = 0, iLen = itemsArr.length; i < iLen; i++) {
                var curItem = itemsArr[i];
                if (progress) {
                    progress.update(
                        progress._current++,
                        "Processing item " + progress._current + " of " + totalCount
                    );
                }

                if (curItem instanceof FootageItem && !(curItem.mainSource instanceof SolidSource)) {
                    count++;
                    try {
                        var fileInfo      = VersionUtils.getFileInfo(curItem.file);
                        var allVersions   = VersionUtils.findAvailableVersions(fileInfo);
                        var targetVersion = VersionUtils.findNextVersion(allVersions, fileInfo.versionInt, goUp);

                        if (targetVersion !== null) {
                            // buildNewPath handles both filename-only and full-path versioning
                            var newPath = VersionUtils.buildNewPath(fileInfo, targetVersion);

                            if (new File(newPath).exists) {
                                curItem.replace(new File(newPath));
                                successCount++;
                            } else {
                                throw new Error("File not found on disk: " + newPath);
                            }
                        } else {
                            // Item is already at the boundary — collect for end summary
                            boundaryItems.push(curItem.name);
                        }
                    } catch (e) {
                        ErrorUtils.handleError("VersionUpdate", "Could not update " + curItem.name + ": " + e.message);
                    }

                } else if (curItem instanceof FolderItem) {
                    var binItems = [];
                    for (var k = 1, kLen = curItem.numItems; k <= kLen; k++) {
                        binItems.push(curItem.item(k));
                    }
                    // BUG FIX: accumulate both count and successCount from recursive call
                    var sub     = VersionOps._processItems(binItems, goUp, progress, totalCount, boundaryItems);
                    count       += sub.count;
                    successCount += sub.successCount;
                }
            }

            return { count: count, successCount: successCount, boundaryItems: boundaryItems };
        },

        /**
         * Public runner — sets up undo group and progress bar, then delegates.
         * @param {Boolean} goUp
         */
        run: function (goUp) {
            if (app.project.selection.length === 0) {
                UIUtils.alert("Please select at least one item.", "No Selection");
                return;
            }

            var label    = goUp ? "Version Up" : "Version Down";
            var items    = app.project.selection;
            var progress = UIUtils.showProgress(label, "Starting...", items.length);
            progress._current = 0;

            app.beginUndoGroup(label);
            var result = VersionOps._processItems(items, goUp, progress, items.length);
            app.endUndoGroup();

            progress.close();

            // Silent on success — only alert when items have nowhere left to go
            if (result.boundaryItems && result.boundaryItems.length > 0) {
                var boundary = goUp ? "latest" : "oldest";
                var msg = "Already at " + boundary + " version:\n";
                for (var b = 0; b < result.boundaryItems.length; b++) {
                    msg += "  - " + result.boundaryItems[b] + "\n";
                }
                UIUtils.alert(msg, "At " + (goUp ? "Latest" : "Oldest") + " Version");
            }
        },

        runReplaceFileUp:   function () { VersionOps.run(true);  },
        runReplaceFileDown: function () { VersionOps.run(false); }
    };

    // -------------------------------------------------------------------------
    // LayerOps — mask and edit-text operations on selected layers
    // -------------------------------------------------------------------------
    var LayerOps = {
        /**
         * Iterates over the selected layers in the active comp, applying callback.
         * BUG FIX: findMenuCommandId("Deselect All") is now cached once before the loop.
         * @param {Function} callback
         * @param {String}   undoName
         */
        processSelectedLayers: function (callback, undoName) {
            var curItem = app.project.activeItem;
            if (!curItem || !(curItem instanceof CompItem)) {
                UIUtils.alert("Please select a composition.", "No Composition");
                return;
            }

            var selectedLayers = curItem.selectedLayers;
            if (selectedLayers.length === 0) {
                UIUtils.alert("Please select at least one layer.", "No Layers");
                return;
            }

            app.beginUndoGroup(undoName);

            // Snapshot indices before we touch anything
            var indices = [];
            for (var i = 0; i < selectedLayers.length; i++) {
                indices.push(selectedLayers[i].index);
            }

            var progress = UIUtils.showProgress("Processing Layers", "Starting...", indices.length);

            // BUG FIX: cache command ID once, not once per iteration
            var deselectAllCmdId = app.findMenuCommandId("Deselect All");
            app.executeCommand(deselectAllCmdId);

            for (var j = 0; j < indices.length; j++) {
                progress.update(j, "Processing layer " + (j + 1) + " of " + indices.length);

                var layer = curItem.layer(indices[j]);
                layer.selected = true;

                try {
                    callback(layer);
                } catch (e) {
                    ErrorUtils.handleError("LayerOperation", "Error processing layer: " + e.message);
                }

                layer.selected = false;
                app.executeCommand(deselectAllCmdId);
            }

            progress.close();
            app.endUndoGroup();
        },

        maskIt: function () {
            LayerOps.processSelectedLayers(function (layer) {
                app.executeCommand(app.findMenuCommandId("New Mask"));
            }, "Apply Mask");
        },

        editIt: function () {
            LayerOps.processSelectedLayers(function (layer) {
                try {
                    app.executeCommand(app.findMenuCommandId("Convert to Editable Text"));
                } catch (e) {
                    throw new Error("Layer is not convertible to editable text.");
                }
            }, "Convert to Editable Text");
        }
    };

    // -------------------------------------------------------------------------
    // PlaceholderOps — replace footage with solid placeholders
    // -------------------------------------------------------------------------
    var PlaceholderOps = {

        runReplaceWithPlaceHolder: function () {
            if (app.project.selection.length === 0) {
                UIUtils.alert("Please select at least one item.", "No Selection");
                return;
            }

            var options = {
                width:  _settings.defaultWidth,
                height: _settings.defaultHeight,
                fps:    _settings.defaultFps
            };

            var confirmCustom = UIUtils.confirm(
                "Use custom placeholder settings?\n\n" +
                "Defaults:\n" +
                "  Width:  " + options.width + "\n" +
                "  Height: " + options.height + "\n" +
                "  FPS:    " + options.fps,
                "Placeholder Options"
            );

            if (confirmCustom) {
                var wInput = prompt("Width (leave blank for default):", "", "Placeholder Options");
                if (wInput) options.width = parseInt(wInput, 10);

                var hInput = prompt("Height (leave blank for default):", "", "Placeholder Options");
                if (hInput) options.height = parseInt(hInput, 10);

                var fInput = prompt("FPS (leave blank for default):", "", "Placeholder Options");
                if (fInput) options.fps = parseFloat(fInput);

                _settings.defaultWidth  = options.width;
                _settings.defaultHeight = options.height;
                _settings.defaultFps    = options.fps;
                SettingsUtils.saveSettings(_settings);
            }

            app.beginUndoGroup("Replace with Placeholder");
            var progress = UIUtils.showProgress("Replacing with Placeholders", "Starting...", app.project.selection.length);
            progress._current = 0;

            var replaceCount = PlaceholderOps._replaceRecursive(app.project.selection, options, progress);
            app.endUndoGroup();
            progress.close();

            UIUtils.alert(replaceCount + " item(s) replaced successfully.", "Done");
        },

        _replaceRecursive: function (itemsArr, options, progress) {
            // Validate options
            if (typeof options !== "object" || options == null) {
                options = { width: _settings.defaultWidth, height: _settings.defaultHeight, fps: _settings.defaultFps };
            } else {
                if (!options.hasOwnProperty("width")  || isNaN(parseInt(options.width, 10)))   options.width  = _settings.defaultWidth;
                if (!options.hasOwnProperty("height") || isNaN(parseInt(options.height, 10)))  options.height = _settings.defaultHeight;
                if (!options.hasOwnProperty("fps")    || isNaN(parseFloat(options.fps)) || options.fps < 1) options.fps = _settings.defaultFps;
            }

            var count = 0;
            var savedItems = { names: [], ids: [] };

            for (var i = 0, iLen = itemsArr.length; i < iLen; i++) {
                var curItem = itemsArr[i];
                if (progress) {
                    progress.update(
                        progress._current++,
                        "Processing item " + progress._current
                    );
                }

                if (curItem instanceof FootageItem &&
                    curItem.mainSource instanceof FileSource &&
                    !(curItem.mainSource instanceof PlaceholderSource) &&
                    curItem.hasVideo) {

                    try {
                        count++;
                        savedItems.names.push(curItem.name);
                        savedItems.ids.push(curItem.id);

                        if (PlaceholderOps._isFileSequence(curItem)) {
                            curItem.setProxyWithSequence(curItem.mainSource.file, false);
                        } else {
                            curItem.setProxy(curItem.mainSource.file);
                        }

                        // Boson blue
                        curItem.replaceWithSolid(
                            [0.21167242527008, 0.80082058906555, 0.87058824300766],
                            curItem.name.substr(0, 31),
                            parseInt(options.width, 10),
                            parseInt(options.height, 10),
                            curItem.pixelAspect
                        );
                    } catch (e) {
                        ErrorUtils.handleError("Placeholder", "Could not replace " + curItem.name + ": " + e.message);
                    }

                } else if (curItem instanceof FolderItem) {
                    var binItems = [];
                    for (var k = 1, kLen = curItem.numItems; k <= kLen; k++) {
                        binItems.push(curItem.item(k));
                    }
                    count += PlaceholderOps._replaceRecursive(binItems, options, progress);
                }
            }

            // Restore original item names
            for (var j = 0, jLen = savedItems.ids.length; j < jLen; j++) {
                try {
                    app.project.itemByID(savedItems.ids[j]).name = savedItems.names[j];
                } catch (e) {
                    ErrorUtils.handleError("Placeholder", "Could not restore item name: " + e.message);
                }
            }

            return count;
        },

        _isFileSequence: function (item) {
            if (item instanceof FootageItem &&
                item.mainSource instanceof FileSource &&
                !(item.mainSource.isStill) &&
                item.hasVideo) {

                var ext = item.mainSource.file.fsName.split(".").pop();
                return ext.match(new RegExp(
                    "(ai|bmp|bw|cin|cr2|crw|dcr|dng|dib|dpx|eps|erf|exr|gif|hdr|ico|icb|iff|" +
                    "jpe|jpeg|jpg|mos|mrw|nef|orf|pbm|pef|pct|pcx|pdf|pic|pict|png|ps|psd|pxr|" +
                    "raf|raw|rgb|rgbe|rla|rle|rpf|sgi|srf|tdi|tga|tif|tiff|vda|vst|x3f|xyze)", "i"
                )) !== null;
            }
            return false;
        }
    };

    // -------------------------------------------------------------------------
    // createUI — builds the ScriptUI panel
    // -------------------------------------------------------------------------
    function createUI(thisObj) {
        var win = (thisObj instanceof Panel) ? thisObj : new Window("dialog", "Boson Save");
        win.frameLocation = [100, 100];
        win.alignChildren = "fill";

        // ── Folder row ────────────────────────────────────────────────────────
        var folderGroup = win.add("group");
        folderGroup.alignChildren = "left";

        _ui.folderButton = folderGroup.add("button", undefined, "Folder");
        _ui.folderButton.preferredSize = [80, 28];

        _ui.favButton = folderGroup.add("button", undefined, "Recent ▾");
        _ui.favButton.preferredSize = [80, 28];

        // Show current folder (shortened)
        var initialLabel = "No folder selected";
        if (_settings.lastFolder) {
            var parts = _settings.lastFolder.replace(/\\/g, "/").split("/");
            initialLabel = (parts.length > 2)
                ? "..." + "/" + parts[parts.length - 2] + "/" + parts[parts.length - 1]
                : _settings.lastFolder;
        }
        _ui.folderPathText = folderGroup.add("statictext", undefined, initialLabel);
        _ui.folderPathText.preferredSize = [220, 20];

        // ── Save panel ────────────────────────────────────────────────────────
        var panelSave = win.add("panel", undefined, "Save");
        panelSave.alignChildren = "right";

        var row1 = panelSave.add("group");
        row1.add("statictext", undefined, "Name");
        _ui.nameField = row1.add("edittext", undefined, "");
        _ui.nameField.preferredSize = [200, 20];

        var row2 = panelSave.add("group");
        row2.add("statictext", undefined, "Type");
        _ui.typeField = row2.add("edittext", undefined, "");
        _ui.typeField.preferredSize = [200, 20];

        var row3 = panelSave.add("group");
        row3.add("statictext", undefined, "Version");
        _ui.versionField = row3.add("edittext", undefined, _settings.defaultVersion || "v001");
        _ui.versionField.preferredSize = [200, 20];

        var saveGroup = win.add("group");
        saveGroup.alignChildren = "left";
        _ui.saveButton = saveGroup.add("button", undefined, "Save");
        _ui.saveButton.preferredSize = [80, 28];

        // ── Functions panel ───────────────────────────────────────────────────
        var functionsPanel = win.add("panel", undefined, "Functions");
        functionsPanel.alignChildren = "left";

        var btnRow1 = functionsPanel.add("group");
        _ui.versionUpButton   = btnRow1.add("button", undefined, "Version Up");
        _ui.versionDownButton = btnRow1.add("button", undefined, "Version Down");
        _ui.placeHoldButton   = btnRow1.add("button", undefined, "PlaceHold");

        var btnRow2 = functionsPanel.add("group");
        _ui.maskItButton  = btnRow2.add("button", undefined, "Mask It");
        _ui.editItButton  = btnRow2.add("button", undefined, "Edit It");

        _ui.versionUpButton.preferredSize   =
        _ui.versionDownButton.preferredSize =
        _ui.placeHoldButton.preferredSize   =
        _ui.maskItButton.preferredSize      =
        _ui.editItButton.preferredSize      = [90, 28];

        // ── Author credit ─────────────────────────────────────────────────────
        var creditGroup = win.add("group");
        creditGroup.alignChildren = "center";
        var creditText = creditGroup.add(
            "statictext", undefined,
            "Eduardo Brandao  |  eduardo@bosonpost.com.br"
        );
        creditText.justify = "center";

        // ── Event handlers ────────────────────────────────────────────────────
        _ui.folderButton.onClick = function () {
            // Temporarily bypass recents and go straight to native dialog
            var f = Folder.selectDialog("Select project folder");
            if (f) {
                _settings.lastFolder = f.fsName;
                FolderFavorites.add(f.fsName);
                SettingsUtils.saveSettings(_settings);

                var pts = f.fsName.replace(/\\/g, "/").split("/");
                _ui.folderPathText.text = (pts.length > 2)
                    ? "..." + "/" + pts[pts.length - 2] + "/" + pts[pts.length - 1]
                    : f.fsName;
                win.layout.layout(true);
            }
        };

        _ui.favButton.onClick = function () {
            // Read settings fresh from disk every time — avoids stale state from panel startup
            var saved = SettingsUtils.loadSettings();
            if (saved) {
                for (var key in saved) {
                    if (saved.hasOwnProperty(key)) _settings[key] = saved[key];
                }
            }
            FileOps.selectFolder();
        };

        _ui.saveButton.onClick = function () {
            FileOps.saveProject(
                _settings.lastFolder,
                _ui.nameField.text,
                _ui.typeField.text,
                _ui.versionField.text
            );
        };

        _ui.versionUpButton.onClick   = function () { VersionOps.runReplaceFileUp();              };
        _ui.versionDownButton.onClick = function () { VersionOps.runReplaceFileDown();             };
        _ui.maskItButton.onClick      = function () { LayerOps.maskIt();                           };
        _ui.editItButton.onClick      = function () { LayerOps.editIt();                           };
        _ui.placeHoldButton.onClick   = function () { PlaceholderOps.runReplaceWithPlaceHolder();  };

        win.layout.layout(true);
        return win;
    }

    // -------------------------------------------------------------------------
    // Compatibility check
    // -------------------------------------------------------------------------
    function checkCompatibility() {
        // BUG FIX: parseFloat("13.10") === 13.1 which breaks comparisons.
        // Parse major and minor separately for a safe integer comparison.
        var parts   = app.version.split(".");
        var major   = parseInt(parts[0], 10);
        var minor   = parts.length > 1 ? parseInt(parts[1], 10) : 0;
        var versionInt = major * 100 + minor; // e.g. 13.10 → 1310

        if (versionInt < 1300) { // CC 2014 = 13.0
            UIUtils.alert("Boson Save requires After Effects CC 2014 (13.0) or later.", "Compatibility");
            return false;
        }
        return true;
    }

    // -------------------------------------------------------------------------
    // init
    // -------------------------------------------------------------------------
    function _applySettings() {
        var saved = SettingsUtils.loadSettings();
        if (saved) {
            for (var key in saved) {
                if (saved.hasOwnProperty(key)) _settings[key] = saved[key];
            }
        }

        // Update the folder path label with restored value
        if (_ui.folderPathText && _settings.lastFolder) {
            var pts = _settings.lastFolder.replace(/\\/g, "/").split("/");
            _ui.folderPathText.text = (pts.length > 4)
                ? ".../" + pts.slice(-4).join("/")
                : _settings.lastFolder.replace(/\\/g, "/");
        }
    }

    function init(thisObj) {
        if (!checkCompatibility()) return;

        // Polyfill itemByID for older AE versions
        if (!app.project.itemByID) {
            app.project.itemByID = function (id) {
                for (var i = 1; i <= app.project.numItems; i++) {
                    if (app.project.item(i).id === id) return app.project.item(i);
                }
                return null;
            };
        }

        var win = createUI(thisObj);
        if (win instanceof Window) {
            win.center();
            win.show();
        }
        _ui.mainWindow = win;
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------
    return {
        init:             init,
        _applySettings:   _applySettings,
        VersionUtils:     VersionUtils,
        UIUtils:          UIUtils,
        ErrorUtils:       ErrorUtils,
        SettingsUtils:    SettingsUtils,
        FolderFavorites:  FolderFavorites,
        FileOps:          FileOps,
        VersionOps:       VersionOps,
        LayerOps:         LayerOps,
        PlaceholderOps:   PlaceholderOps
    };

})();

// Entry point
function Save_Boson(thisObj) {
    BosonSave.init(thisObj);
}

Save_Boson(this);
