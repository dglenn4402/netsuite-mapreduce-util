/**
 * @NApiVersion 2.x
 * @NScriptType Suitelet
 */
define(["require", "exports", "N/search", "N/ui/serverWidget", "N/file", "N/error", "N/runtime", "N/task", "N/format"], function (require, exports, search, ui, file, error, runtime, task, format) {
    Object.defineProperty(exports, "__esModule", { value: true });
    var ACTIONS = {
        showForm: showForm,
        getAsset: getAsset,
        getDeployments: getDeployments,
        runScript: runScript,
        getInstances: getInstances,
        getLogs: getLogs,
    };
    function onRequest(context) {
        try {
            var action = context.request.parameters.cust_action || 'showForm';
            if (ACTIONS.hasOwnProperty(action)) {
                ACTIONS[action](context);
            }
            else {
                context.response.write("Invalid action " + action);
            }
        }
        catch (err) {
            context.response.write(JSON.stringify(err));
        }
    }
    exports.onRequest = onRequest;
    function showForm(context) {
        var form = ui.createForm({ title: 'Map Reduce Util' });
        var url = '/app/site/hosting/scriptlet.nl?script=customscript_mos_mapreduceutil_sl&deploy=customdeploy_mos_mapreduceutil_sl&cust_action=getAsset&cust_asset=index.html';
        form.addField({ id: 'content', label: 'Content', type: ui.FieldType.INLINEHTML }).defaultValue = "<iframe src=\"" + url + "\" style=\"display: block; height: 73vh; width: 100%; border: none;\"></iframe>";
        context.response.writePage(form);
    }
    function getScriptFileId(scriptId) {
        var results = search
            .create({
            type: 'script',
            filters: ['scriptid', search.Operator.IS, scriptId],
            columns: ['scriptfile'],
        })
            .run()
            .getRange({ start: 0, end: 1 });
        if (results.length !== 1) {
            throw error.create({
                name: 'MOS_MAP_REDUCE_UTIL',
                message: 'Unable to determine script file id',
            });
        }
        return results[0].getValue({ name: 'scriptfile' });
    }
    function getCurrentScriptFilePath() {
        var scriptId = runtime.getCurrentScript().id;
        var scriptFileId = getScriptFileId(scriptId);
        // @ts-ignore
        var scriptFile = file.load({ id: scriptFileId });
        return scriptFile.path;
    }
    function getCurrentScriptFolderPath() {
        var scriptFilePath = getCurrentScriptFilePath();
        var lastSlash = scriptFilePath.lastIndexOf('/');
        return scriptFilePath.substring(0, lastSlash);
    }
    function getAsset(context) {
        var assetFileName = context.request.parameters.cust_asset;
        var scriptFolderPath = getCurrentScriptFolderPath();
        var assetFile = file.load({
            id: scriptFolderPath + "/assets/" + assetFileName,
        });
        context.response.write(assetFile.getContents());
    }
    function getDeployments(context) {
        var results = [];
        search
            .create({
            type: search.Type.SCRIPT_DEPLOYMENT,
            filters: [
                ['script.scripttype', search.Operator.ANYOF, 'MAPREDUCE'],
                'AND',
                ['isdeployed', search.Operator.IS, 'T'],
            ],
            columns: [
                'title',
                'scriptid',
                search.createColumn({ name: 'scriptid', join: 'script' }),
            ],
        })
            .run()
            .each(function (result) {
            results.push({
                text: result.getValue({ name: 'title' }),
                value: {
                    scriptId: result.getValue({ name: 'scriptid', join: 'script' }),
                    deploymentId: result.getValue({ name: 'scriptid' }),
                    deploymentInternalID: result.id,
                },
            });
            return true;
        });
        context.response.write(JSON.stringify(results));
    }
    function runScript(context) {
        var payload = JSON.parse(context.request.body);
        var taskId = task
            .create({
            taskType: task.TaskType.MAP_REDUCE,
            scriptId: payload.scriptId,
            deploymentId: payload.deploymentId,
        })
            .submit();
        var status = task.checkStatus({ taskId: taskId });
        context.response.write({ output: JSON.stringify({ taskId: taskId, status: status }) });
    }
    function convertPacificDateToEpoch(date) {
        var dateObj = format.parse({
            value: date,
            type: format.Type.DATETIMETZ,
            timezone: format.Timezone.AMERICA_LOS_ANGELES,
        });
        // @ts-ignore
        return typeof dateObj.getTime === 'function' ? dateObj.getTime() : null;
    }
    function getInstances(context) {
        var payload = JSON.parse(context.request.body);
        var results = {};
        search
            .create({
            type: search.Type.SCHEDULED_SCRIPT_INSTANCE,
            filters: [
                ['datecreated', search.Operator.WITHIN, 'today'],
                'AND',
                [
                    'scriptdeployment.internalid',
                    search.Operator.ANYOF,
                    payload.deploymentInternalID,
                ],
            ],
            columns: [
                'taskid',
                'datecreated',
                'status',
                'percentcomplete',
                'mapreducestage',
                'startdate',
                'enddate',
            ],
        })
            .run()
            .each(function (result) {
            var taskId = String(result.getValue({ name: 'taskid' }));
            if (!results.hasOwnProperty(taskId)) {
                results[taskId] = {
                    taskId: taskId,
                    dateCreated: convertPacificDateToEpoch(result.getValue({ name: 'datecreated' })),
                    status: result.getValue({ name: 'status' }),
                    percentComplete: result.getValue({ name: 'percentcomplete' }),
                    stages: [],
                };
            }
            results[taskId].stages.push({
                stage: result.getValue({ name: 'mapreducestage' }),
                startDate: convertPacificDateToEpoch(result.getValue({ name: 'startdate' })),
                endDate: convertPacificDateToEpoch(result.getValue({ name: 'enddate' })),
            });
            return true;
        });
        // Object.values not available in ES5
        var resultsArray = Object.keys(results).map(function (key) { return results[key]; });
        context.response.write(JSON.stringify(resultsArray, null, 2));
    }
    function getLogs(context) {
        var payload = JSON.parse(context.request.body);
        var results = [];
        search
            .create({
            type: 'scriptexecutionlog',
            filters: [
                ['date', search.Operator.WITHIN, 'today'],
                'AND',
                [
                    'scriptdeployment.internalid',
                    search.Operator.ANYOF,
                    payload.deploymentInternalID,
                ],
                'AND',
                ['internalidnumber', search.Operator.GREATERTHAN, payload.lastLogId],
            ],
            columns: [
                'type',
                'date',
                'time',
                'title',
                'detail',
                search.createColumn({
                    name: 'internalid',
                    sort: search.Sort.ASC,
                }),
            ],
        })
            .run()
            .each(function (result) {
            results.push({
                id: result.id,
                type: result.getValue({ name: 'type' }),
                date: result.getValue({ name: 'date' }),
                time: result.getValue({ name: 'time' }),
                title: result.getValue({ name: 'title' }),
                detail: result.getValue({ name: 'detail' }),
            });
            return true;
        });
        context.response.write(JSON.stringify(results));
    }
});
