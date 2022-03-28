#! /usr/local/bin/node

var WS = require('ws');
var { exec } = require('child_process');
var myArgs = process.argv.slice(2);
var port = myArgs[1];
var uuid = myArgs[3];
var registerEvent = myArgs[5];
var ws;
var debug = false;
var logging = false;
if (debug) {
    class MockWS {
        on(action, fn) {
            this[action] = fn;
        }

        send(message) {
            console.log("SENT:", message);
        }
    };
    ws = new MockWS();
} else {
    ws = new WS('ws://127.0.0.1:' + port);
}


var StatusEnum = Object.freeze({
    DISCONNECTED: 0,
    CONNECTING: 1,
    CONNECTED: 2,
});
var StatusName = Object.freeze({
    'connected': StatusEnum.CONNECTED,
    'connecting': StatusEnum.CONNECTING,
    'disconnected': StatusEnum.DISCONNECTED,
});

var slowRefresh = 4000;
var fastRefresh = 250;
var intervalId = undefined;
var vpnStatus = undefined;

var DestinationEnum = Object.freeze({
    HARDWARE_AND_SOFTWARE: 0,
    HARDWARE_ONLY: 1,
    SOFTWARE_ONLY: 2
});
var serviceName = undefined; // eg "Nuonic VPN"


if (logging) {
    var fs = require('fs');
    var util = require('util');
    var logFile = fs.createWriteStream('/tmp/streamdeck.log', {flags : 'w'});
    var logStdout = process.stdout;
    console.log = function () {
        logFile.write(util.format.apply(null, arguments) + '\n');
        logStdout.write(util.format.apply(null, arguments) + '\n');
    }
    console.error = console.log;
}

function connect() {
    console.log('connecting');
    exec(`networksetup -connectpppoeservice "${serviceName}"`, (err, stdout, stderr) => {
        if (err) {
          console.error(err);
          return;
        }
        console.log(stdout);
    });
}

function disconnect() {
    console.log('disconnecting');
    exec(`networksetup -disconnectpppoeservice "${serviceName}"`, (err, stdout, stderr) => {
        if (err) {
          console.error(err);
          return;
        }
        console.log(stdout);
    });
}

function setStatus(context, state) {
    vpnStatus = state;
    var json = {
        event: 'setState',
        context: context,
        payload: {
            target: DestinationEnum.HARDWARE_AND_SOFTWARE,
            state: state
        }
    };
    ws.send(JSON.stringify(json));
}

function showAlert(context) {
    var json = {
        event: 'showAlert',
        context: context,
    }
    ws.send(JSON.stringify(json));
}

function monitorStart(context, interval) {
    if (serviceName === undefined || serviceName === "") {
        monitorStop();
        return;
    }
    
    if (intervalId !== undefined) {
        clearInterval(intervalId);
    }
    updateStatus(context);
    intervalId = setInterval(updateStatus, interval, context);
}

function monitorStop() {
    clearInterval(intervalId);
}

function updateStatus(context) {
    exec(`networksetup -showpppoestatus "${serviceName}"`, (err, stdout, stderr) => {
        if (err) {
          console.error(err);
          return;
        } else {
            var response = stdout.split('\n')[0];
            var status = StatusName[response];
            console.log({vpnStatus, response, status});
            if (status === undefined) {
                monitorStop();
                setTimeout(setStatus, fastRefresh, context, StatusEnum.DISCONNECTED);
                showAlert();  // unknown response, e.g. "" if connection name is invalid
            } else if (status !== vpnStatus) {
                setStatus(context, status);
                monitorStart(context, status === StatusEnum.CONNECTING ? fastRefresh : slowRefresh);
            }
        }
    });
}

function setSettings(context) {
    var json = {
        "event": "setSettings",
        "context": context,
        "payload": {serviceName: serviceName},
    };
    console.log('setSettings', json);
    ws.send(JSON.stringify(json));
}

function toggle(context) {
    monitorStart(context, fastRefresh);
    switch (vpnStatus) {
    case StatusEnum.DISCONNECTED:
        connect();
        break;
    case StatusEnum.CONNECTING:
        disconnect();
        break;
    case StatusEnum.CONNECTED:
        disconnect();
        break;
    }
}

ws.on('open', function () {
    var json = {
        event: registerEvent,
        uuid: uuid
    };
    ws.send(JSON.stringify(json));
});

ws.on('message', function (evt) {
    var jsonObj = JSON.parse(evt);
    console.log('on message', jsonObj);
    if (jsonObj.event) {
        switch (jsonObj.event) {
        case 'keyDown':
            toggle(jsonObj.context);
            break;
        case 'willAppear':
            serviceName = jsonObj.payload.settings.serviceName;
            monitorStart(jsonObj.context, slowRefresh);
            break;
        case 'willDisappear':
            monitorStop();
            break;
        case 'didReceiveSettings':
            serviceName = jsonObj.payload.settings.serviceName;
            monitorStart(jsonObj.context, slowRefresh);
            break;
        case 'sendToPlugin':
            console.log('sendToPlugin received');
            if (jsonObj.payload?.serviceName) {
                serviceName = jsonObj.payload.serviceName;
                console.log('new service', serviceName);
                setSettings(jsonObj.context);
                monitorStart(jsonObj.context, slowRefresh);
            }
            break;
        default:
            console.log('unhandled', jsonObj.event);
        }
    }
});

if (debug) {
    ws.open()
    ws.message('{"event":"willAppear", "context": "--context--"}');
    ws.message('{"event":"didReceiveSettings", "payload":{"settings":{"serviceName": "Nuonic VPN"}}}');
    setInterval(ws.message, 5000, '{"event":"keyDown", "context": "--context--"}');
}