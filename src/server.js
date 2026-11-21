'use strict';

const config = require('./config');
const { criarApp } = require('./app');

const { app, monitor } = criarApp(config);

const server = app.listen(config.port, config.host, () => {
  console.log(`Lexxproc rodando em http://localhost:${config.port}`);
  if (config.demoMode) console.log('Modo demonstração ativo: dados fictícios.');
  monitor.iniciar();
});

function encerrar() {
  monitor.parar();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
