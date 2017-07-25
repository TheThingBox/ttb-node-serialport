/**
* Copyright 2013,2015 IBM Corp.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
* http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
**/

module.exports = function(RED) {
    "use strict";
    var settings = RED.settings;
    var events = require("events");
    var Serialport = require("serialport");
    var bufMaxSize = 32768;  // Max serial buffer size, for inputs...

    function TTBSerialOutNode(n) {
        RED.nodes.createNode(this,n);
        this.serial = n.serial;
        this.serialConfig = RED.nodes.getNode(this.serial);

        if (this.serialConfig) {
            var node = this;
            serialPool.get(
                this.serialConfig.serialport,
                this.serialConfig.serialbaud,
                this.serialConfig.databits,
                this.serialConfig.parity,
                this.serialConfig.stopbits,
                this.serialConfig.newline,
                0,
                function(serialp){
                    node.port = serialp;
                    node.addCh = "";
                    if (node.serialConfig.addchar == "true" || node.serialConfig.addchar === true) {
                        node.addCh = this.serialConfig.newline.replace("\\n","\n").replace("\\r","\r").replace("\\t","\t").replace("\\e","\e").replace("\\f","\f").replace("\\0","\0"); // jshint ignore:line
                    }
                    node.on("input",function(msg) {
                        if (msg.hasOwnProperty("payload")) {
                            var payload = msg.payload;
                            if (!Buffer.isBuffer(payload)) {
                                if (typeof payload === "object") {
                                    payload = JSON.stringify(payload);
                                } else {
                                    payload = payload.toString();
                                }
                                payload += node.addCh;
                            } else if (node.addCh !== "") {
                                payload = Buffer.concat([payload,new Buffer(node.addCh)]);
                            }
                            node.port.write(payload,function(err,res) {
                                if (err) {
                                    var errmsg = err.toString().replace("Serialport","Serialport "+node.port.serial.path);
                                    node.error(errmsg,msg);
                                }
                            });
                        }
                    });
                    node.port.on('ready', function() {
                        node.status({fill:"green",shape:"dot",text:"node-red:common.status.connected"});
                    });
                    node.port.on('closed', function() {
                        node.status({fill:"red",shape:"ring",text:"node-red:common.status.not-connected"});
                    });
                });
        } else {
            this.error(RED._("node-serialport.errors.missing-conf"));
        }

        this.on("close", function(done) {
            if (this.serialConfig) {
                serialPool.close(this.serialConfig.serialport,done);
            } else {
                done();
            }
        });
    }
    RED.nodes.registerType("ttb serial out",TTBSerialOutNode);


    function TTBSerialInNode(n) {
        RED.nodes.createNode(this,n);
        this.serial = n.serial;
        this.intervalCount = n.intervalCount;
        this.intervalUnits = n.intervalUnits;
        var multiplicator = 1;
        if (this.intervalUnits == "m"){
            multiplicator = 60;
        } else if (this.intervalUnits == "h"){
            multiplicator = 60*60;
        }
        this.repeatError = 1000*Number(this.intervalCount)*multiplicator;
        this.serialConfig = RED.nodes.getNode(this.serial);

        if (this.serialConfig) {
            var node = this;
            node.tout = null;
            var buf;
            if (node.serialConfig.out != "count") { buf = new Buffer(bufMaxSize); }
            else { buf = new Buffer(Number(node.serialConfig.newline)); }
            var i = 0;
            node.status({fill:"grey",shape:"dot",text:"node-red:common.status.not-connected"});

            serialPool.get(
                node.serialConfig.serialport,
                node.serialConfig.serialbaud,
                node.serialConfig.databits,
                node.serialConfig.parity,
                node.serialConfig.stopbits,
                node.serialConfig.newline,
                node.repeatError,
                function(serialp){
                    node.port = serialp;
                    var splitc;
                    if (node.serialConfig.newline.substr(0,2) == "0x") {
                        splitc = new Buffer([parseInt(node.serialConfig.newline)]);
                    } else {
                        splitc = new Buffer(node.serialConfig.newline.replace("\\n","\n").replace("\\r","\r").replace("\\t","\t").replace("\\e","\e").replace("\\f","\f").replace("\\0","\0")); // jshint ignore:line
                    }

                    node.port.on('tryToReconnect', function(msg) {
                        node.send([null,{payload:"error with : Serial port "+node.serialConfig.serialport}]);
                    });

                    node.port.on('data', function(msg) {
                        // single char buffer
                        if ((node.serialConfig.newline === 0)||(node.serialConfig.newline === "")) {
                            if (node.serialConfig.bin !== "bin") { node.send([{"payload": String.fromCharCode(msg)},null]); }
                            else { node.send([{"payload": new Buffer([msg])}],null); }
                        }
                        else {
                            // do the timer thing
                            if (node.serialConfig.out === "time") {
                                if (node.tout) {
                                    i += 1;
                                    buf[i] = msg;
                                }
                                else {
                                    node.tout = setTimeout(function () {
                                        node.tout = null;
                                        var m = new Buffer(i+1);
                                        buf.copy(m,0,0,i+1);
                                        if (node.serialConfig.bin !== "bin") { m = m.toString(); }
                                        node.send([{"payload": m},null]);
                                        m = null;
                                    }, node.serialConfig.newline);
                                    i = 0;
                                    buf[0] = msg;
                                }
                            }
                            // count bytes into a buffer...
                            else if (node.serialConfig.out === "count") {
                                buf[i] = msg;
                                i += 1;
                                if ( i >= parseInt(node.serialConfig.newline)) {
                                    var m = new Buffer(i);
                                    buf.copy(m,0,0,i);
                                    if (node.serialConfig.bin !== "bin") { m = m.toString(); }
                                    node.send([{"payload":m},null]);
                                    m = null;
                                    i = 0;
                                }
                            }
                            // look to match char...
                            else if (node.serialConfig.out === "char") {
                                buf[i] = msg;
                                i += 1;
                                if ((msg === splitc[0]) || (i === bufMaxSize)) {
                                    var n = new Buffer(i);
                                    buf.copy(n,0,0,i);
                                    if (node.serialConfig.bin !== "bin") { n = n.toString(); }
                                    node.send([{"payload":n},null]);
                                    n = null;
                                    i = 0;
                                }
                            }
                        }
                    });
                    node.port.on('ready', function() {
                        node.status({fill:"green",shape:"dot",text:"node-red:common.status.connected"});
                    });
                    node.port.on('closed', function() {
                        node.status({fill:"red",shape:"ring",text:"node-red:common.status.not-connected"});
                    });
                }
            );

        } else {
            this.error(RED._("node-serialport.errors.missing-conf"));
        }

        this.on("close", function(done) {
            if (this.serialConfig) {
                serialPool.close(this.serialConfig.serialport,done);
            } else {
                done();
            }
        });
    }
    RED.nodes.registerType("ttb serial in",TTBSerialInNode);


    var serialPool = (function() {
        var connections = {};
        return {
            get:function(port,baud,databits,parity,stopbits,newline,repeatError,callback) {
                var id = port;
                if (!connections[id]) {
                    getConnection(port,baud,databits,parity,stopbits,newline,repeatError,function(connection){
                        connections[id] = connection;                        
                        callback(connections[id]);
                    });
                } else {
                    callback(connections[id]);
                }
            },
            close: function(port,done) {
                if (connections[port]) {
                    if (connections[port].tout != null) {
                        clearTimeout(connections[port].tout);
                    }
                    connections[port]._closing = true;
                    try {
                        connections[port].close(function() {
                            RED.log.info(RED._("node-serialport.errors.closed",{port:port}));
                            done();
                        });
                    }
                    catch(err) { }
                    delete connections[port];
                } else {
                    done();
                }
            }
        }
    }());

    function getConnection(port,baud,databits,parity,stopbits,newline,repeatError,cbConnection){
        var obj = {
            _port : "",
            _emitter: new events.EventEmitter(),
            serial: null,
            repeatError : 0,
            _closing: false,
            tout: null,
            on: function(a,b) { this._emitter.on(a,b); },
            close: function(cb) { this.serial.close(cb); },
            write: function(m,cb) { this.serial.write(m,cb); },
        }
        var setupSerial = function(cbSetup) {
            Serialport.list(function(err,data){
                if (!err &&port.indexOf("/dev/") != 0){                        
                    obj._port = getDevPath(data,port);
                } else {
                    obj._port = port;
                }
                obj.serial = new Serialport.SerialPort(obj._port,{
                    baudRate: baud,
                    dataBits: databits,
                    parity: parity,
                    stopBits: stopbits,
                    parser: Serialport.parsers.raw,
                    autoOpen: true
                }, function(err, results) {                                
                    obj._closing = false;
                    obj.repeatError = repeatError;
                    if (err) {                              
                        if (obj.repeatError > 0){
                            obj._emitter.emit('tryToReconnect');
                            obj.tout = setTimeout(function() {
                                setupSerial();
                            }, obj.repeatError);
                        }
                    }
                });
                obj.serial.on('error', function(err) {
                    obj._emitter.emit('closed');
                    if (obj.repeatError > 0){
                        obj._emitter.emit('tryToReconnect');
                        obj.tout = setTimeout(function() {
                            setupSerial();
                        }, obj.repeatError);
                    }
                });
                obj.serial.on('close', function() {
                    if (!obj._closing) {
                        obj._emitter.emit('closed');
                        if (obj.repeatError > 0){
                            obj._emitter.emit('tryToReconnect');
                            obj.tout = setTimeout(function() {
                                setupSerial();
                            }, obj.repeatError);
                        }
                    }
                });
                obj.serial.on('open',function() {
                    RED.log.info(RED._("node-serialport.onopen",{port:obj._port,baud:baud,config: databits+""+parity.charAt(0).toUpperCase()+stopbits}));
                    if (obj.tout) { clearTimeout(obj.tout); }
                    obj._emitter.emit('ready');
                });
                obj.serial.on('data',function(d) {
                    for (var z=0; z<d.length; z++) {
                        obj._emitter.emit('data',d[z]);
                    }
                });
                obj.serial.on("disconnect",function() {
                    RED.log.error(RED._("node-serialport.errors.disconnected",{port:obj._port}));
                });
                if (cbSetup){
                    cbSetup(obj);
                }
            });
        }

        setupSerial(function(connection){
            cbConnection(connection);
        });
    }

    function getDevPath(data, search){
        for (var device in data){
            for (var item in data[device]){
                if (data[device][item].indexOf(search) != -1){
                    return data[device].comName;
                }
            }
        }
        return search;
    }

}
