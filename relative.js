'use strict'

const fs = require('fs')
const path = require('path')

module.exports = {
  save: function(data, relative) {
    return fs.writeFileSync(path.join(__dirname, relative), data)
  },
  jsonSave: function(data, relative) {
    return module.exports.save(JSON.stringify(data), relative)
  },
  exists: function(relative) {
    return fs.existsSync(path.join(__dirname, relative))
  },
  read: function(relative) {
    return fs.readFileSync(path.join(__dirname, relative)).toString('utf8')
  },
  jsonRead: function(relative) {
    return JSON.parse(module.exports.read(relative))
  }
}