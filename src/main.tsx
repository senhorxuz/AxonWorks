import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { FeedbackProvider } from './Feedback';
import { PortaDaAxon } from './entrada';
import { criarAvisoDeDesligamento, criarBatida, manterServidorVivo, pedirSaude } from './batida';
import { FaixaDeDesligamento } from './AvisoDeDesligamento';
import './styles.css';
import './art-direction.css';
import './leitura.css';
import './recompensas.css';
import './tato.css';
import './tela-grande.css';
// O servidor que o atalho liga se desliga sozinho sem uso; com a aba à vista, a página avisa a cada 5 minutos.
// Se a batida não acha o servidor (ele se desligou com a aba escondida), a faixa diz isso até uma batida dar certo.
const avisoDeDesligamento = criarAvisoDeDesligamento();
manterServidorVivo(document, criarBatida(() => pedirSaude(fetch), avisoDeDesligamento), window);
createRoot(document.getElementById('root')!).render(<React.StrictMode><FeedbackProvider><PortaDaAxon><App /></PortaDaAxon><FaixaDeDesligamento aviso={avisoDeDesligamento} /></FeedbackProvider></React.StrictMode>);
