process.env["NODE_ENV"] = "test";
var assert = require("assert");
var fs = require("fs");
var crypto = require("crypto");
var async = require("async");
var ecdsa = require("ecdsa");
var ecurve = require('ecurve');
var BigInteger = require('bigi');
var sr = require("secure-random");
var bitcoind = require(__dirname + "/../lib/bitcoind.js");
var constants = require(__dirname + "/../lib/constants.js");
var controller = require(__dirname + "/../lib/controllers");
var models = require(__dirname + "/../lib/models");

var initializer = {
    "node_metadata": "bbbbbba948904f2f0f479b8f8197694b30184b0d2ed1c1cd2a1ec0fb85d299a192a447",
    "output_txid": "a948904f2f0f479b8f8197694b30184b0d2ed1c1cd2a1ec0fb85d299a192a447",
    "create_node_and_rights": function(done){
        console.log("creating node and rights");
        var n = models.Node.build({
            "metadata" :initializer.node_metadata,
            "destroyed": false
        });
        n.save().complete(function(err){
            if(err) return done(err);
            var rights = models.RightsOutput.build({
                "spent": false,
                "txid": initializer.output_txid,
                "vout": 0
            });
            n.addRightsOutputs(rights).complete(function(err){
                if(err) return done(err);
                done();
            });
        });
    },
    "create_node_and_color_one_right": function(done){
        var n = models.Node.build({
            "metadata": initializer.node_metadata,
            "destroyed": false
        });
        n.save().complete(function(err){
            if(err) return done(err);
            bitcoind("listunspent 0", function(err, arr){
                if(err) return done(err);
                if(arr.length === 0) {
                    done({
                        error: "insufficient funds in bitcoin wallet"
                    });
                }

                var rights = models.RightsOutput.build({
                    spent: false,
                    txid: arr[0].txid,
                    vout: arr[0].vout
                });
                n.addRightsOutputs(rights).complete(function(err){
                    if(err) return done(err);
                    done()
                })
            });
        })
    },
    "clear_db": function(done){
        async.each(["User", "RightsOutput", "Node", "Signature"], function(name, inner_cb){
            models[name].destroy().complete(function(err){
                inner_cb(err || null);
            });
        }, function(err){
            done(err || undefined);
        });
    },
    "color_unspent": function(done){
        bitcoind("listunspent 0", function(err, res){
            if (res.length == 0) { // there is nothing to color
                done();
                return;
            }

            var end_pos = res.length / 3 || 1;
            var colored_inputs = res.slice(0, end_pos);

            models.Node.findOne({ where: {
                "metadata": initializer.node_metadata,
                "destroyed": false
            }}).complete(function(err, node){
                if(err) return done(err);
                async.each(colored_inputs, function(item, cb){
                    var output = models.RightsOutput.build({
                        "txid": item.txid,
                        "vout": item.vout,
                        "node_id": node.id,
                        "spent": false
                    });
                    output.save().complete(function(err){
                        cb(err);
                    });
                }, function(err){
                    return done(err || undefined);
                });
            });
        });
    }
};

describe("Controller", function(){
    before(initializer.clear_db);

    describe("#query", function(){
        
        // "listrights": ["auth_token"],
        describe("listrights", function(){
            before(initializer.clear_db);
            before(initializer.create_node_and_rights);
            before(initializer.color_unspent);

            it("should list all the colored unspent inputs", function(done){
                controller.query({
                    "method": "listrights"
                }, function(err, colored){
                    assert.equal(err, null);
                    bitcoind("listunspent 0", function(err, all){
                        assert.equal(err, null);
                        colored.forEach(function(item){
                            assert(all.some(function(x){
                                return item.txid === x.txid && item.vout === x.vout;
                            }));
                        });
                        done();
                    });
                });                
            });
        });

        // "listnodes": ["auth_token"],
        describe("listnodes", function(done){
            var hexstrings = [];

            before(initializer.clear_db);
            before(function(done){
                var i, node;
                for (i = 0 ; i < 100 ; i += 10) {
                    hexstrings.push(crypto.createHash("sha256").update(i.toString()).digest().toString("hex") + "ababab");
                }

                for (i = 0  ; i < hexstrings.length ; i++) {
                    (function(index){
                        node = models.Node.build({
                            "destroy": false,
                            "metadata": hexstrings[i]
                        });
                        node.save().complete(function(err, results){
                            if(err) return done(err);
                            if(index === hexstrings.length - 1) {
                                done();
                            }
                        })
                    })(i);
                }

            });

            it("should list all available nodes in the network", function(done){
                controller.query({
                    "method": "listnodes"
                }, function(err, nodes){
                    var i;
                    for (i = 0 ; i < nodes.length ; i++) {
                        var node = nodes[i];
                        // check if the node is inside
                        assert.equal(hexstrings.some(function(hexstring){
                            return hexstring === node.metadata;
                        }), true);
                    }
                    done();
                })
            });
        });

        // "listusers": ["auth_token", "metadata"],
        describe("listusers", function(){
            var addresses = [
                "mtHPApo7dHwCdXmkn3D2ENKQAzENYPDpsk",
                "muETzXRwNfZNNhRcJ17novohr9dCjGEkAJ",
                "mrSSTWZKy8he8dSnxbvrHFJrKao7axyqmj"
            ];

            before(initializer.clear_db);
            before(function(done){

                var n = models.Node.build({
                    "metadata": initializer.node_metadata,
                    "destroyed": false
                });
                n.save().complete(function(err, node){
                    assert.equal(err, null);
                    assert.notEqual(addresses, null);
                    async.each(addresses, function(addr, cb){

                        var user = models.User.build({
                            "address": addr,
                            "public_key": "ef1ea5a5e38af57572c4e757f2c5ac51dee7796ec5ab076da3d61c990b43ba5fab"
                        });
                        n.addUser(user).complete(function(err){
                            cb(err);
                        });

                    }, function(err){
                        assert.equal(err, null);
                        done();
                    });
                })
            });

            it("should list users of a given node", function(done){
                controller.query({
                    "method": "listusers",
                    "metadata": initializer.node_metadata
                }, function(err, users){
                    addresses.forEach(function(addr){
                        assert.equal(users.some(function(user){
                            return user.address === addr;
                        }), true);
                    });
                    done();
                });
            });
        });

        // "verifysignature": ["auth_token", "metadata", "address", "document", "signature_r", "signature_s"]
        describe("verifysignature", function(){
            var user_address = "mhMmtUf7928pEi52EhxrqeQGWuQEoHPtW7";
            var msg = "hello world";
            var private_key = sr.randomBuffer(32);
            var public_key = ecurve.getCurveByName('secp256k1').G.
                multiply(BigInteger.fromBuffer(private_key)).
                getEncoded(true).toString("hex");
            var signature = ecdsa.sign(crypto.createHash('sha256').update(msg).digest(), private_key);

            before(initializer.clear_db);
            before(initializer.create_node_and_rights);
            before(function(done){

                models.Node.findOne({ where: {
                    "metadata": initializer.node_metadata,
                    "destroyed": false
                }}).complete(function(err, node){

                    if(err) return done(err);
                    var user = models.User.build({
                        "address": user_address,
                        "public_key": public_key,
                        "node_id": node.id
                    });
                    user.save().complete(function(err){
                        if(err) return done(err);
                        var r = models.Signature.build({
                            "user_id": user.id,
                            "type": "r",
                            "node_id": node.id,
                            "metadata": signature.r.toHex()
                        });
                        var s = models.Signature.build({
                            "user_id": user.id,
                            "type": "s",
                            "node_id": node.id,
                            "metadata": signature.s.toHex()
                        });
                        r.save().complete(function(err){
                            if(err) return done(err);
                            s.save().complete(function(err){
                                if(err) return done(err);
                                console.log("hooks are good");
                                done();
                            })
                        })
                    });
                });
            });

            it("should be able to verify document against some signature", function(done){
                controller.query({
                    "method": "verifysignature",
                    "metadata": initializer.node_metadata,
                    "address": user_address,
                    "document": msg,
                    "signature_r": signature.r.toHex(),
                    "signature_s": signature.s.toHex()
                }, function(err, obj){
                    assert.equal(err, null);
                    assert.notEqual(obj, undefined);
                    assert.equal(obj.verified, true);
                    done();
                });
            });
        });
    });

    describe("#broadcast" , function(){
        describe("initialize", function(){
            var metadata = "bbbbbba948904f2f0f479b8f8197694b30184b0d2ed1c1cd2a1ec0fb85d299a192a447";
            var txid;
            before(initializer.clear_db);
            before(function(done){
                controller.broadcast({
                    method: "initialize",
                    metadata: metadata
                }, function(err, res){
                    if(err) return done(err);
                    txid = res.txid;
                    done();
                });
            });

            it("should create a new node in the database", function(done){
                models.Node.findOne({ where: {
                    "metadata": metadata,
                    "destroyed": false 
                }}).complete(function(err, node){
                    assert.equal(err, null);
                    assert.notEqual(node, null);
                    assert.equal(node.metadata, metadata);
                    done();
                })
            });

            it("should create the appropriate rights output in db", function(done){
                models.Node.findOne({ where: {
                    "metadata": metadata,
                    "destroyed": false
                }}).complete(function(err, node){
                    if(err) return done(err);
                    node.getRightsOutputs({ where: {
                        txid: txid , vout: 0
                    }}).complete(function(err, outputs){
                        if(err) return done(err);
                        var output = outputs[0];

                        assert.notEqual(output, null);
                        assert.equal(output.txid, txid);
                        assert.equal(output.vout, 0);
                        done();
                    });
                })
            });

            it("should create the appropriate bitcoin transaction", function(done){
                bitcoind("getrawtransaction " + txid + " 1", function(err, tx){
                    if(err) return done(err);
                    // the results should contain an op_return output in the vout = 1
                    var op_return = tx.vout[1].scriptPubKey.hex;
                    assert.equal(op_return.substring(0, 2), "6a");
                    assert.equal(op_return.substring(2, 4), "27");
                    assert.equal(op_return.substring(4, 10), "424350");
                    assert.equal(op_return.substring(10, 12), "00");
                    assert.equal(op_return.substring(12, 82), metadata);
                    done();
                });
            });
        });

        describe("registeruser", function(){
            var user_address = "n1Ggjhc9XSgJ446yMQUdzk8UJ9won5uGer";
            var public_key = "aab948904f2f0f479b8f8197694b30184b0d2ed1c1cd2a1ec0fb85d299a192a447";
            var txid;

            before(initializer.clear_db);
            before(initializer.create_node_and_color_one_right);
            before(function(done){
                controller.broadcast({
                    method: "registeruser",
                    metadata: initializer.node_metadata,
                    address: user_address,
                    public_key: public_key
                }, function(err, res){
                    if(err) return done(err);
                    txid = res.txid;
                    done();
                })
            });

            it("should create a user in the database", function(done){
                models.Node.findOne({ where: {
                    "metadata": initializer.node_metadata
                }}).complete(function(err, node){
                    if(err) done(err);
                    assert.notEqual(node, null);
                    node.getUsers({ where: {
                        "address": user_address,
                        "public_key": public_key
                    }}).complete(function(err, users){
                        if(err) done(err);
                        assert.notEqual(users.length, 0);
                        done();
                    });
                });
            });
            it("should create the appropriate rights output", function(done){
                models.Node.findOne({ where: {
                    "metadata": initializer.node_metadata,
                    "destroyed": false
                }}).complete(function(err, node){
                    if(err) return done(err);
                    node.getRightsOutputs({ where: {
                        txid: txid , vout: 0
                    }}).complete(function(err, outputs){
                        if(err) return done(err);
                        var output = outputs[0];

                        assert.notEqual(output, null);
                        assert.equal(output.txid, txid);
                        assert.equal(output.vout, 0);
                        done();
                    });
                });
            });
            it("should create the appropriate bitcoin transaction", function(done){
                bitcoind("getrawtransaction " + txid + " 1", function(err, tx){
                    if(err) return done(err);
                    // the results should contain an op_return output in the vout = 1
                    var op_return = tx.vout[1].scriptPubKey.hex;
                    assert.equal(op_return.substring(0, 2), "6a");
                    assert.equal(op_return.substring(2, 4), "25");
                    assert.equal(op_return.substring(4, 10), "424350");
                    assert.equal(op_return.substring(10, 12), "01");
                    assert.equal(op_return.substring(12, 82), public_key);

                    assert.equal(tx.vout[2].scriptPubKey.addresses[0], user_address);
                    done();
                });
            });
        });

        describe("terminate", function(){
            var txid;

            before(initializer.clear_db);
            before(initializer.create_node_and_color_one_right);
            before(function(done){
                controller.broadcast({
                    method: "terminate",
                    metadata: initializer.node_metadata
                }, function(err, res){
                    if(err) return done(err);

                    txid = res.txid;
                    done();
                });
            });

            it("should mark the node as destroyed in the database", function(done){
                models.Node.findOne({ where: {
                    destroyed: true,
                    metadata: initializer.node_metadata
                }}).complete(function(err, node){
                    if(err) return done(err);
                    assert.notEqual(node, null);
                    done();
                });
            });
            it("should create an appropriate bitcoin transaction", function(done){
                bitcoind("getrawtransaction " + txid + " 1", function(err, tx){
                    if(err) return done(err);
                    // special case for terminating resul,
                    // if should contain an op_return output in the vout = 0
                    var op_return = tx.vout[0].scriptPubKey.hex;
                    assert.equal(op_return.substring(0, 2), "6a");
                    assert.equal(op_return.substring(2, 4), "27");
                    assert.equal(op_return.substring(4, 10), "424350");
                    assert.equal(op_return.substring(10, 12), "ff");
                    assert.equal(op_return.substring(12), initializer.node_metadata);
                    done();
                });
            });
        });

        describe("broadcastsignature", function(){
            var user_address = "n1Ggjhc9XSgJ446yMQUdzk8UJ9won5uGer";
            var s_txid, r_txid;

            var doc = "hello world";
            var private_key = sr.randomBuffer(32);
            var public_key = ecurve.getCurveByName('secp256k1').
                G.multiply(BigInteger.fromBuffer(private_key)).
                getEncoded(true).toString("hex");
            var signature = ecdsa.sign(crypto.createHash('sha256').update(doc).digest(), private_key);

            before(initializer.clear_db);
            before(initializer.create_node_and_color_one_right);
            before(function(done){
                models.Node.findOne({ where: {
                    metadata: initializer.node_metadata
                }}).complete(function(err, node){
                    if(err) return done(err);
                    var user = models.User.build({
                        "public_key": public_key,
                        "address": user_address
                    });
                    node.addUser(user).complete(function(){
                        if(err) return done(err);
                        done();
                    });
                })
            });
            before(function(done){
                controller.broadcast({
                    method: "broadcastsignature",
                    metadata: initializer.node_metadata,
                    address: user_address,
                    document: doc,
                    signature_r: signature.r.toHex(),
                    signature_s: signature.s.toHex()
                }, function(err, res){
                    if(err) return done(err);
                    s_txid = res.s_txid;
                    r_txid = res.r_txid;
                    done();
                })
            });

            it("should create the signatures in the database", function(done){
                models.Node.findOne({ where: {
                    metadata: initializer.node_metadata
                }}).complete(function(err, node){
                    if(err) return done(err);
                    assert.notEqual(node, null);
                    models.User.findOne({ where: {
                        node_id: node.id,
                        address: user_address
                    }}).complete(function(err, user){
                        assert.notEqual(user, null);
                        models.Signature.findOne({ where: {
                            type: "r",
                            metadata: signature.r.toHex(),
                            user_id: user.id
                        }}).complete(function(err, res){
                            if(err) return done(err);
                            assert.notEqual(res, null);
                            models.Signature.findOne({ where: {
                                type: "s",
                                metadata: signature.s.toHex(),
                                user_id: user.id
                            }}).complete(function(err, res){
                                if(err) return done(err);
                                assert.notEqual(res, null);
                                done();
                            });
                        });
                    })
                });
            });
            it("should create an appropriate outputs (both spent and unspent)", function(done){
                models.Node.findOne({ where: {
                    "metadata": initializer.node_metadata,
                    "destroyed": false
                }}).complete(function(err, node){
                    if(err) return done(err);
                    node.getRightsOutputs({ where: {
                        txid: r_txid , vout: 0, spent: true
                    }}).complete(function(err, outputs){
                        if(err) return done(err);
                        var output = outputs[0];
                        assert.notEqual(output, null);
                        assert.notEqual(output, undefined);
                        
                        node.getRightsOutputs({ where: {
                            txid: s_txid, vout: 0, spent: false
                        }}).complete(function(err, outputs){
                            if(err) return done(err);
                            var output = outputs[0];
                            assert.notEqual(output, null);
                            assert.notEqual(output, undefined);
                        })

                        done();
                    });
                });
            });
            it("should create an appropriate bitcoin transaction", function(done){
                bitcoind("getrawtransaction " + r_txid + " 1", function(err, tx){
                    if(err) return done(err);
                    // the results should contain an op_return output in the vout = 1
                    var op_return = tx.vout[1].scriptPubKey.hex;
                    assert.equal(op_return.substring(0, 2), "6a");
                    assert.equal(op_return.substring(2, 4), "24");
                    assert.equal(op_return.substring(4, 10), "424350");
                    assert.equal(op_return.substring(10, 12), "02");
                    assert.equal(op_return.substring(12), signature.r.toHex());
                    assert.equal(tx.vout[2].scriptPubKey.addresses[0], user_address);
                    
                    bitcoind("getrawtransaction " + s_txid + " 1", function(err, tx){
                        if(err) return done(er);
                        var op_return = tx.vout[1].scriptPubKey.hex
                        assert.equal(op_return.substring(0, 2), "6a");
                        assert.equal(op_return.substring(2, 4), "24");
                        assert.equal(op_return.substring(4, 10), "424350");
                        assert.equal(op_return.substring(10, 12), "03");
                        assert.equal(op_return.substring(12), signature.s.toHex());
                        assert.equal(tx.vout[2].scriptPubKey.addresses[0], user_address);
                        done();
                    });

                });
            });
        });
    });

    describe("#execute", function(){
        describe("op_initialize", function(){
            before(initializer.clear_db);

            it("should create a new node in the database", function(done){
                var metadata = "bbbbbba948904f2f0f479b8f8197694b30184b0d2ed1c1cd2a1ec0fb85d299a192a447";
                controller.execute({
                    "op_code": constants.OP_INITIALIZE,
                    "metadata": new Buffer(metadata, "hex")
                }, function(err){
                    assert.equal(err, null);

                    models.Node.findOne({ where: {
                        "metadata": metadata,
                        "destroyed": false
                    }}).complete(function(err, results){
                        assert.equal(err, null);
                        assert.notEqual(results, null);
                        assert.equal(results.metadata, metadata);
                        done();
                    });
                });
            });
        });

        describe("op_register", function(){
            var public_key = "aab948904f2f0f479b8f8197694b30184b0d2ed1c1cd2a1ec0fb85d299a192a447";

            before(initializer.clear_db);
            before(initializer.create_node_and_rights);

            it("should create a new user in the database", function(done){
                controller.execute({
                    "op_code": constants.OP_REGISTER,
                    "metadata": new Buffer(public_key, "hex"),
                    "address": "n1Ggjhc9XSgJ446yMQUdzk8UJ9won5uGer",
                    "rights_input": {
                        "txid": initializer.output_txid,
                        "vout": 0
                    }
                }, function(err, results){

                    models.Node.findOne({ where: {
                        "metadata": initializer.node_metadata,
                        "destroyed": false
                    }}).complete(function(err, node){
                        assert.equal(err, null);
                        assert.notEqual(node, null);
                        models.User.findOne({ where: {
                            "public_key": public_key,
                            "node_id": node.id
                        }}).complete(function(err, user){
                            assert.equal(err, null);
                            assert.notEqual(user, null);
                            assert.equal(user.public_key, public_key);
                            done();
                        });
                    });
                });
            });
        });

        describe("op_signature_r", function(){
            var signature_metadata = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";
            var user_address = "n1Ggjhc9XSgJ446yMQUdzk8UJ9won5uGer";

            before(initializer.clear_db);
            before(initializer.create_node_and_rights);
            before(function(done){
                models.Node.findOne({ where: {
                    "metadata": initializer.node_metadata,
                    "destroyed": false
                }}).complete(function(err, node){
                    if(err) return done(err);
                    var user = models.User.build({
                        "public_key": "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9ac",
                        "address": user_address
                    });
                    node.addUser(user).complete(function(){
                        if(err) return done(err);
                        done();
                    });
                });
            });

            it("should create a 'r' signature in the database", function(done){
                controller.execute({
                    "op_code": constants.OP_SIGNATURE_R,
                    "metadata": new Buffer(signature_metadata, "hex"),
                    "address": user_address,
                    "rights_input": {
                        "txid": initializer.output_txid,
                        "vout": 0
                    }
                }, function(err){
                    assert.equal(err, null);
                    models.Node.findOne({ where: {
                        "metadata": initializer.node_metadata,
                        "destroyed": false
                    }}).complete(function(err, node){
                        assert.equal(err, null);
                        assert.equal(node.metadata, initializer.node_metadata);
                        models.User.findOne({ where: {
                            "node_id": node.id,
                            "address": user_address
                        }}).complete(function(err, user){
                            assert.equal(err, null);
                            assert.equal(user.address, user_address);
                            models.Signature.findOne({ where: {
                                "user_id": user.id,
                                "type": "r",
                                "metadata": signature_metadata
                            }}).complete(function(err, signature){
                                assert.equal(err, null);
                                assert.notEqual(signature, null);
                                assert.equal(signature.metadata, signature_metadata);
                                assert.equal(signature.type, "r");
                                done();
                            });
                        });
                    })
                });
            });
        });

        describe("op_signature_s", function(){
            var signature_metadata = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";
            var user_address = "n1Ggjhc9XSgJ446yMQUdzk8UJ9won5uGer";

            before(initializer.clear_db);
            before(initializer.create_node_and_rights);
            before(function(done){
                models.Node.findOne({ where: {
                    "metadata": initializer.node_metadata,
                    "destroyed": false
                }}).complete(function(err, node){
                    if(err) return done(err);
                    var user = models.User.build({
                        "public_key": "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9ac",
                        "address": user_address
                    });
                    node.addUser(user).complete(function(){
                        if(err) return done(err);
                        done();
                    });
                });
            });

            it("should create a 's' signature in the database", function(done){
                controller.execute({
                    "op_code": constants.OP_SIGNATURE_S,
                    "metadata": new Buffer(signature_metadata, "hex"),
                    "address": user_address,
                    "rights_input": {
                        "txid": initializer.output_txid,
                        "vout": 0
                    }
                }, function(err){
                    assert.equal(err, null);
                    models.Node.findOne({ where: {
                        "metadata": initializer.node_metadata,
                        "destroyed": false
                    }}).complete(function(err, node){
                        assert.equal(err, null);
                        assert.equal(node.metadata, initializer.node_metadata);
                        models.User.findOne({ where: {
                            "node_id": node.id,
                            "address": user_address
                        }}).complete(function(err, user){
                            assert.equal(err, null);
                            assert.equal(user.address, user_address);
                            models.Signature.findOne({ where: {
                                "user_id": user.id,
                                "type": "s",
                                "metadata": signature_metadata
                            }}).complete(function(err, signature){
                                assert.equal(err, null);
                                assert.equal(signature.metadata, signature_metadata);
                                assert.equal(signature.type, "s");
                                done();
                            });
                        });
                    })
                });
            });
        });

        describe("op_terminate_node", function(){
            before(initializer.clear_db);
            before(initializer.create_node_and_rights);

            it("should terminate the node", function(done){
                controller.execute({
                    "op_code": constants.OP_TERMINATE_NODE,
                    "metadata": new Buffer(initializer.node_metadata, "hex"),
                    "rights_input": {
                        "txid": initializer.output_txid,
                        "vout": 0
                    }
                }, function(err, results){
                    models.Node.findOne({ where: {
                        "metadata": initializer.node_metadata,
                        "destroyed": false
                    }}).complete(function(err, results){
                        assert.equal(err, null);
                        assert.equal(results, null);
                        done();
                    });
                });
            });
        });
    });
});
