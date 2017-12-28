'use strict'

const http = require('http')
const fs = require('fs')
const cp = require('child_process')
const os = require('os')
const querystring = require('querystring')

const okResponse = `
<html>
<head>
    <script>window.close()</script>
</head>
<body>
    <h3>Done ! You can close the tab</h3>
</body>
</html>
`

function launchServer(cb) {
  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
      fs.createReadStream('oauth.html').pipe(res)
    } else if (req.url.indexOf('/oauth/') === 0) {
      const queryParams = querystring.parse(req.url.substring(req.url.indexOf('/oauth/') + '/oauth/?'.length))
      if (queryParams.error_reason !== undefined) {
        res.writeHead(301,
          {Location: 'http://localhost:300/'}
        );
        res.write('<h3>Declined, you can redo the operation, by going to http://localhost:3000</h3>')
        res.end()
      }
      else if (queryParams.code !== undefined) {
        res.write(okResponse)
        res.end()
        server.close()
        cb(null, queryParams.code)
      }
    } else {
      res.statusCode = 404
      res.write('<h1>404 Not Found</h1>')
      res.end()
    }
  })
  server.listen(3000)
}

module.exports = {

  getCode: function(cb) {
    launchServer(cb)
    console.log('trying to launch browser to url: http://localhost:3000')
    console.log('if it does not open a browser, go to the url manually to authorize the app')
    try {
      if (os.platform() === 'win32')
        cp.exec('start http://localhost:3000')
      else if (os.platform() === 'linux')
        cp.exec('xdg-open http://localhost:3000')
    } catch (err) {
      console.error(err)
    }
  },

}
