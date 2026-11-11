using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

namespace GaicosBotTray
{
    public class BotApplicationContext : ApplicationContext
    {
        private NotifyIcon notifyIcon;
        private ContextMenuStrip menuContexto;
        private Form formTerminal;
        private TextBox txtTerminal;
        private Label lblStatus;
        private Process processoNode;
        private bool encerrando = false;
        private bool avisouOcultar = false;
        private DateTime ultimoCliqueBandeja = DateTime.MinValue;
        private readonly string pastaBase;
        private readonly string urlPainel = "http://localhost:3000";
        private readonly int portaBot = 3000;
        private string caminhoNode = null;
        private Icon iconeApp;

        public BotApplicationContext()
        {
            pastaBase = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\', '/');
            Application.ApplicationExit += OnApplicationExit;

            iconeApp = CriarIconeGaicos();
            ConstruirJanelaTerminal();
            ConstruirMenuBandeja();

            notifyIcon = new NotifyIcon();
            notifyIcon.Icon = iconeApp;
            notifyIcon.Text = "Gaicos Bot - Em execu\u00e7\u00e3o (Clique para abrir o terminal)";
            notifyIcon.ContextMenuStrip = menuContexto;
            notifyIcon.Visible = true;
            notifyIcon.MouseClick += OnNotifyIconMouseClick;
            notifyIcon.BalloonTipClicked += (s, e) => MostrarTerminal();

            // Inicia a preparacao e o servidor em background sem travar a UI e sem abrir janelas
            Thread t = new Thread(FluxoInicializacao);
            t.IsBackground = true;
            t.Start();
        }

        private Icon CriarIconeGaicos()
        {
            using (Bitmap bmp = new Bitmap(32, 32))
            {
                using (Graphics g = Graphics.FromImage(bmp))
                {
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.Clear(Color.Transparent);

                    using (SolidBrush brushFundo = new SolidBrush(Color.FromArgb(37, 211, 102)))
                    {
                        g.FillEllipse(brushFundo, 1, 1, 29, 29);
                    }
                    using (Pen penBorda = new Pen(Color.FromArgb(18, 140, 126), 1.5f))
                    {
                        g.DrawEllipse(penBorda, 1, 1, 29, 29);
                    }
                    using (Font fonte = new Font("Segoe UI", 17f, FontStyle.Bold, GraphicsUnit.Pixel))
                    using (StringFormat formato = new StringFormat())
                    {
                        formato.Alignment = StringAlignment.Center;
                        formato.LineAlignment = StringAlignment.Center;
                        g.DrawString("G", fonte, Brushes.White, new RectangleF(0, 0, 32, 32), formato);
                    }
                }
                return Icon.FromHandle(bmp.GetHicon());
            }
        }

        private void ConstruirJanelaTerminal()
        {
            formTerminal = new Form();
            formTerminal.Text = "Gaicos Bot - Terminal";
            formTerminal.Size = new Size(840, 520);
            formTerminal.MinimumSize = new Size(620, 360);
            formTerminal.StartPosition = FormStartPosition.CenterScreen;
            formTerminal.BackColor = Color.FromArgb(15, 23, 42);
            formTerminal.ForeColor = Color.White;
            formTerminal.Icon = iconeApp;
            formTerminal.ShowInTaskbar = false;

            Panel painelTopo = new Panel();
            painelTopo.Dock = DockStyle.Top;
            painelTopo.Height = 46;
            painelTopo.BackColor = Color.FromArgb(30, 41, 59);
            painelTopo.Padding = new Padding(12, 8, 12, 8);

            lblStatus = new Label();
            lblStatus.Text = "\u25cf Gaicos Bot - Iniciando...";
            lblStatus.ForeColor = Color.FromArgb(74, 222, 128);
            lblStatus.Font = new Font("Segoe UI", 10f, FontStyle.Bold);
            lblStatus.AutoSize = true;
            lblStatus.Location = new Point(14, 13);

            FlowLayoutPanel painelBotoes = new FlowLayoutPanel();
            painelBotoes.Dock = DockStyle.Right;
            painelBotoes.AutoSize = true;
            painelBotoes.FlowDirection = FlowDirection.LeftToRight;
            painelBotoes.WrapContents = false;
            painelBotoes.BackColor = Color.Transparent;

            Button btnAbrirPainel = CriarBotaoBarra("Abrir Painel no Navegador", Color.FromArgb(22, 163, 74));
            Button btnReiniciar = CriarBotaoBarra("Reiniciar Bot", Color.FromArgb(37, 99, 235));
            Button btnOcultar = CriarBotaoBarra("Ocultar na Bandeja", Color.FromArgb(71, 85, 105));
            Button btnEncerrar = CriarBotaoBarra("Encerrar Bot", Color.FromArgb(220, 38, 38));

            btnAbrirPainel.Click += (s, e) => AbrirPainelNavegador();
            btnReiniciar.Click += (s, e) => ReiniciarBotManualmente();
            btnOcultar.Click += (s, e) => OcultarTerminal();
            btnEncerrar.Click += (s, e) => EncerrarTudo();

            painelBotoes.Controls.Add(btnAbrirPainel);
            painelBotoes.Controls.Add(btnReiniciar);
            painelBotoes.Controls.Add(btnOcultar);
            painelBotoes.Controls.Add(btnEncerrar);

            painelTopo.Controls.Add(lblStatus);
            painelTopo.Controls.Add(painelBotoes);

            txtTerminal = new TextBox();
            txtTerminal.Multiline = true;
            txtTerminal.ReadOnly = true;
            txtTerminal.ScrollBars = ScrollBars.Vertical;
            txtTerminal.Dock = DockStyle.Fill;
            txtTerminal.BackColor = Color.FromArgb(12, 12, 12);
            txtTerminal.ForeColor = Color.FromArgb(229, 231, 235);
            txtTerminal.Font = new Font("Consolas", 10f);
            txtTerminal.BorderStyle = BorderStyle.None;
            txtTerminal.WordWrap = true;

            formTerminal.Controls.Add(txtTerminal);
            formTerminal.Controls.Add(painelTopo);

            // Forca criacao do handle sem mostrar a janela na tela
            IntPtr h = formTerminal.Handle;
            IntPtr ht = txtTerminal.Handle;

            formTerminal.FormClosing += (s, e) =>
            {
                if (!encerrando && e.CloseReason == CloseReason.UserClosing)
                {
                    e.Cancel = true;
                    OcultarTerminal();
                }
            };

            formTerminal.Resize += (s, e) =>
            {
                if (formTerminal.WindowState == FormWindowState.Minimized)
                {
                    OcultarTerminal();
                }
            };
        }

        private Button CriarBotaoBarra(string texto, Color corFundo)
        {
            Button btn = new Button();
            btn.Text = texto;
            btn.AutoSize = true;
            btn.Height = 30;
            btn.FlatStyle = FlatStyle.Flat;
            btn.FlatAppearance.BorderSize = 0;
            btn.BackColor = corFundo;
            btn.ForeColor = Color.White;
            btn.Font = new Font("Segoe UI", 9f, FontStyle.Bold);
            btn.Cursor = Cursors.Hand;
            btn.Margin = new Padding(6, 0, 0, 0);
            return btn;
        }

        private void ConstruirMenuBandeja()
        {
            menuContexto = new ContextMenuStrip();

            ToolStripMenuItem itemAbrirPainel = new ToolStripMenuItem("Abrir Painel no Navegador");
            itemAbrirPainel.Font = new Font(itemAbrirPainel.Font, FontStyle.Bold);
            itemAbrirPainel.Click += (s, e) => AbrirPainelNavegador();

            ToolStripMenuItem itemAlternarTerminal = new ToolStripMenuItem("Mostrar / Ocultar Terminal");
            itemAlternarTerminal.Click += (s, e) => AlternarTerminal();

            ToolStripMenuItem itemReiniciar = new ToolStripMenuItem("Reiniciar Bot");
            itemReiniciar.Click += (s, e) => ReiniciarBotManualmente();

            ToolStripSeparator separador = new ToolStripSeparator();

            ToolStripMenuItem itemEncerrar = new ToolStripMenuItem("Encerrar Bot");
            itemEncerrar.ForeColor = Color.FromArgb(185, 28, 28);
            itemEncerrar.Click += (s, e) => EncerrarTudo();

            menuContexto.Items.Add(itemAbrirPainel);
            menuContexto.Items.Add(itemAlternarTerminal);
            menuContexto.Items.Add(itemReiniciar);
            menuContexto.Items.Add(separador);
            menuContexto.Items.Add(itemEncerrar);
        }

        private void OnNotifyIconMouseClick(object sender, MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Left)
            {
                DateTime agora = DateTime.UtcNow;
                if ((agora - ultimoCliqueBandeja).TotalMilliseconds < 350)
                {
                    return;
                }
                ultimoCliqueBandeja = agora;
                AlternarTerminal();
            }
        }

        private void AbrirPainelNavegador()
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = urlPainel,
                    UseShellExecute = true
                });
            }
            catch (Exception ex)
            {
                AdicionarLog("[ERRO] N\u00e3o foi poss\u00edvel abrir o navegador: " + ex.Message);
            }
        }

        private void MostrarTerminal()
        {
            if (formTerminal.InvokeRequired)
            {
                formTerminal.BeginInvoke(new Action(MostrarTerminal));
                return;
            }
            formTerminal.ShowInTaskbar = true;
            if (!formTerminal.Visible)
            {
                formTerminal.Show();
            }
            formTerminal.WindowState = FormWindowState.Normal;
            formTerminal.Activate();
            formTerminal.BringToFront();
            txtTerminal.SelectionStart = txtTerminal.TextLength;
            txtTerminal.ScrollToCaret();
        }

        private void OcultarTerminal()
        {
            if (formTerminal.InvokeRequired)
            {
                formTerminal.BeginInvoke(new Action(OcultarTerminal));
                return;
            }
            formTerminal.ShowInTaskbar = false;
            formTerminal.Hide();
            if (!avisouOcultar && !encerrando)
            {
                avisouOcultar = true;
                notifyIcon.ShowBalloonTip(
                    3000,
                    "Gaicos Bot continua ativo",
                    "O terminal foi recolhido para a bandeja do sistema (ao lado do rel\u00f3gio). Clique no \u00edcone para reabrir.",
                    ToolTipIcon.Info
                );
            }
        }

        private void AlternarTerminal()
        {
            if (formTerminal.Visible && formTerminal.WindowState != FormWindowState.Minimized)
            {
                OcultarTerminal();
            }
            else
            {
                MostrarTerminal();
            }
        }

        private void AdicionarLog(string linha)
        {
            if (linha == null || encerrando) return;
            if (formTerminal == null || formTerminal.IsDisposed) return;

            if (formTerminal.InvokeRequired)
            {
                try
                {
                    formTerminal.BeginInvoke(new Action<string>(AdicionarLog), linha);
                }
                catch { }
                return;
            }

            if (txtTerminal.TextLength > 120000)
            {
                txtTerminal.Text = txtTerminal.Text.Substring(txtTerminal.TextLength - 80000);
            }
            txtTerminal.AppendText(linha + Environment.NewLine);
        }

        private void AtualizarStatus(string texto, Color cor)
        {
            if (formTerminal == null || formTerminal.IsDisposed) return;
            if (formTerminal.InvokeRequired)
            {
                try
                {
                    formTerminal.BeginInvoke(new Action<string, Color>(AtualizarStatus), texto, cor);
                }
                catch { }
                return;
            }
            lblStatus.Text = texto;
            lblStatus.ForeColor = cor;
        }

        private string EncontrarNode()
        {
            string[] candidatos = new string[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs", "node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "nodejs", "node.exe")
            };

            foreach (string c in candidatos)
            {
                if (!string.IsNullOrEmpty(c) && File.Exists(c))
                {
                    return c;
                }
            }

            string pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
            foreach (string dir in pathEnv.Split(Path.PathSeparator))
            {
                try
                {
                    if (string.IsNullOrWhiteSpace(dir)) continue;
                    string full = Path.Combine(dir.Trim(), "node.exe");
                    if (File.Exists(full)) return full;
                }
                catch { }
            }

            return null;
        }

        private void ExecutarPreparacaoPowerShell(bool forcarAtualizacao)
        {
            string scriptPs1 = Path.Combine(pastaBase, "Instalar-Primeira-Execucao.ps1");
            if (!File.Exists(scriptPs1)) return;

            string args = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + scriptPs1 + "\" -ApenasPreparar";
            if (forcarAtualizacao) args += " -ForcarAtualizacao";

            ProcessStartInfo psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = args,
                WorkingDirectory = pastaBase,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8
            };

            using (Process p = Process.Start(psi))
            {
                p.OutputDataReceived += (s, e) => { if (e.Data != null) AdicionarLog(e.Data); };
                p.ErrorDataReceived += (s, e) => { if (e.Data != null) AdicionarLog(e.Data); };
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();
                p.WaitForExit();
            }
        }

        private bool PortaEstaEmUso(int porta)
        {
            try
            {
                using (TcpClient client = new TcpClient())
                {
                    IAsyncResult result = client.BeginConnect("127.0.0.1", porta, null, null);
                    bool conectado = result.AsyncWaitHandle.WaitOne(TimeSpan.FromMilliseconds(250));
                    if (conectado && client.Connected)
                    {
                        return true;
                    }
                }
            }
            catch { }
            return false;
        }

        private void LiberarPortaOcupada(int porta)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = "netstat.exe",
                    Arguments = "-ano",
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true
                };

                string saida;
                using (Process p = Process.Start(psi))
                {
                    saida = p.StandardOutput.ReadToEnd();
                    p.WaitForExit(3000);
                }

                int meuPid = Process.GetCurrentProcess().Id;
                // Independente de idioma do Windows (LISTENING / ESCUTANDO / etc.)
                Regex regex = new Regex(@"TCP\s+\S+:" + porta + @"\s+\S+\s+\S+\s+(\d+)", RegexOptions.IgnoreCase);
                foreach (Match m in regex.Matches(saida))
                {
                    int pid;
                    if (int.TryParse(m.Groups[1].Value, out pid) && pid > 0 && pid != meuPid)
                    {
                        try
                        {
                            Process antigo = Process.GetProcessById(pid);
                            AdicionarLog("Encerrando inst\u00e2ncia anterior na porta " + porta + " (PID " + pid + ")...");
                            antigo.Kill();
                            antigo.WaitForExit(3000);
                        }
                        catch { }
                    }
                }
            }
            catch { }

            // Fallback extra: se a porta 3000 ainda estiver ocupada por um node.exe antigo, encerra o node.exe orfao
            if (PortaEstaEmUso(porta))
            {
                foreach (Process p in Process.GetProcessesByName("node"))
                {
                    try
                    {
                        AdicionarLog("Encerrando processo node.exe anterior (PID " + p.Id + ")...");
                        p.Kill();
                        p.WaitForExit(2000);
                    }
                    catch { }
                }
                Thread.Sleep(400);
            }
        }

        private void FluxoInicializacao()
        {
            try
            {
                caminhoNode = EncontrarNode();
                bool expressExiste = Directory.Exists(Path.Combine(pastaBase, "node_modules", "express"));

                if (caminhoNode == null || !expressExiste)
                {
                    AtualizarStatus("\u25cf Preparando ambiente...", Color.FromArgb(250, 204, 21));
                    AdicionarLog("Preparando ambiente de primeira execu\u00e7\u00e3o...");
                    ExecutarPreparacaoPowerShell(false);
                    caminhoNode = EncontrarNode();
                }

                if (caminhoNode == null)
                {
                    AtualizarStatus("\u25cf Node.js n\u00e3o encontrado", Color.FromArgb(248, 113, 113));
                    AdicionarLog("[ERRO] Node.js n\u00e3o foi encontrado. Verifique sua conex\u00e3o com a internet.");
                    return;
                }

                IniciarProcessoNode();

                formTerminal.BeginInvoke(new Action(() =>
                {
                    notifyIcon.ShowBalloonTip(
                        3500,
                        "Gaicos Bot em segundo plano",
                        "O bot est\u00e1 ativo na bandeja ao lado do rel\u00f3gio. Clique no \u00edcone para ver o terminal ou com o bot\u00e3o direito para abrir o painel.",
                        ToolTipIcon.Info
                    );
                }));
            }
            catch (Exception ex)
            {
                AtualizarStatus("\u25cf Erro na inicializa\u00e7\u00e3o", Color.FromArgb(248, 113, 113));
                AdicionarLog("[ERRO FATAL] " + ex.Message);
            }
        }

        private void PararProcessoNode()
        {
            Process proc = processoNode;
            processoNode = null;
            if (proc != null)
            {
                try
                {
                    if (!proc.HasExited)
                    {
                        proc.Kill();
                        proc.WaitForExit(3000);
                    }
                }
                catch { }
                try { proc.Dispose(); } catch { }
            }
        }

        private void IniciarProcessoNode()
        {
            if (encerrando) return;

            PararProcessoNode();
            LiberarPortaOcupada(portaBot);

            if (caminhoNode == null)
            {
                caminhoNode = EncontrarNode();
            }

            AdicionarLog("================================================");
            AdicionarLog("Iniciando Gaicos Bot (Painel: " + urlPainel + ")");
            AdicionarLog("O bot est\u00e1 rodando oculto na bandeja do Windows.");
            AdicionarLog("================================================");

            ProcessStartInfo psi = new ProcessStartInfo
            {
                FileName = caminhoNode,
                Arguments = "server.js",
                WorkingDirectory = pastaBase,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8
            };

            Process proc = new Process();
            proc.StartInfo = psi;
            proc.EnableRaisingEvents = true;
            proc.OutputDataReceived += (s, e) => { if (e.Data != null) AdicionarLog(e.Data); };
            proc.ErrorDataReceived += (s, e) => { if (e.Data != null) AdicionarLog("[ERRO] " + e.Data); };
            proc.Exited += OnProcessoNodeExited;

            proc.Start();
            proc.BeginOutputReadLine();
            proc.BeginErrorReadLine();
            processoNode = proc;

            AtualizarStatus("\u25cf Gaicos Bot - Em execu\u00e7\u00e3o (" + urlPainel + ")", Color.FromArgb(74, 222, 128));
        }

        private void OnProcessoNodeExited(object sender, EventArgs e)
        {
            if (encerrando) return;

            Process proc = sender as Process;
            int codigoSaida = -1;
            try
            {
                if (proc != null) codigoSaida = proc.ExitCode;
            }
            catch { }

            if (codigoSaida == 42)
            {
                AdicionarLog("\u21bb Reiniciando o programa conforme solicitado...");
                Thread t = new Thread(IniciarProcessoNode);
                t.IsBackground = true;
                t.Start();
            }
            else if (codigoSaida == 43)
            {
                AdicionarLog("\u21bb Atualizando bibliotecas antes de reiniciar...");
                Thread t = new Thread(() =>
                {
                    ExecutarPreparacaoPowerShell(true);
                    IniciarProcessoNode();
                });
                t.IsBackground = true;
                t.Start();
            }
            else if (codigoSaida == 0)
            {
                EncerrarTudo();
            }
            else
            {
                AtualizarStatus("\u25cf Gaicos Bot - Parado (c\u00f3digo " + codigoSaida + ")", Color.FromArgb(248, 113, 113));
                AdicionarLog("\u26a0 O processo do bot parou (c\u00f3digo " + codigoSaida + "). Use 'Reiniciar Bot' no \u00edcone da bandeja para tentar novamente.");
            }
        }

        private void ReiniciarBotManualmente()
        {
            AdicionarLog("");
            AdicionarLog("\u21bb Reiniciando o bot manualmente...");
            Thread t = new Thread(IniciarProcessoNode);
            t.IsBackground = true;
            t.Start();
        }

        private void EncerrarTudo()
        {
            if (encerrando) return;
            encerrando = true;

            PararProcessoNode();

            if (formTerminal != null && formTerminal.InvokeRequired)
            {
                try
                {
                    formTerminal.BeginInvoke(new Action(FinalizarComponentesUI));
                    return;
                }
                catch { }
            }
            FinalizarComponentesUI();
        }

        private void FinalizarComponentesUI()
        {
            try
            {
                if (notifyIcon != null)
                {
                    notifyIcon.Visible = false;
                    notifyIcon.Dispose();
                    notifyIcon = null;
                }
            }
            catch { }

            try
            {
                if (formTerminal != null && !formTerminal.IsDisposed)
                {
                    formTerminal.Close();
                    formTerminal.Dispose();
                }
            }
            catch { }

            Application.ExitThread();
            Environment.Exit(0);
        }

        private void OnApplicationExit(object sender, EventArgs e)
        {
            encerrando = true;
            PararProcessoNode();
            if (notifyIcon != null)
            {
                notifyIcon.Visible = false;
                notifyIcon.Dispose();
            }
        }
    }

    public static class Program
    {
        private static Mutex mutex;

        [STAThread]
        public static void Main()
        {
            // Encerra qualquer instancia antiga do GaicosBot para substituir de forma limpa
            int meuPid = Process.GetCurrentProcess().Id;
            foreach (Process p in Process.GetProcessesByName(Process.GetCurrentProcess().ProcessName))
            {
                if (p.Id != meuPid)
                {
                    try
                    {
                        p.Kill();
                        p.WaitForExit(2000);
                    }
                    catch { }
                }
            }

            // Encerra eventual janela antiga de PowerShell com -ModoBandeja da versao anterior
            try
            {
                ProcessStartInfo psiCleanup = new ProcessStartInfo
                {
                    FileName = "wmic.exe",
                    Arguments = "process where \"name='powershell.exe' and commandline like '%ModoBandeja%'\" call terminate",
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true
                };
                using (Process pc = Process.Start(psiCleanup))
                {
                    pc.WaitForExit(2000);
                }
            }
            catch { }

            bool criouNovo;
            mutex = new Mutex(true, @"Local\GaicosBotTraySingleInstance", out criouNovo);

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new BotApplicationContext());
        }
    }
}
