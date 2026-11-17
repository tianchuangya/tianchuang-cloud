// Adapted in part from LocalSend CLI (https://github.com/localsend/localsend),
// Copyright the LocalSend contributors, licensed under Apache License 2.0.
// Modifications: JSON-lines IPC, atomic receive staging, Tianchuang Cloud events.

use anyhow::{Context, anyhow};
use bytes::Bytes;
use futures_util::StreamExt;
use localsend::crypto::cert::fingerprint_from_cert_der;
use localsend::discovery::{
    DEFAULT_DISCOVERY_TIMEOUT, DeviceChannel, DeviceIdentity, DiscoveredDevice, DiscoveryConfig,
    DiscoveryEvent, DiscoveryHandle, StatefulDevice,
};
use localsend::http::client::ClientError;
use localsend::http::client::v2::LsHttpClientV2;
use localsend::http::dto_v2::{PrepareUploadRequestDtoV2, RegisterDtoV2};
use localsend::http::server::common::save::FileUploadTarget;
use localsend::http::server::v2::{
    PrepareUploadDecisionV2, ServerEventV2, SessionEndReasonV2,
};
use localsend::http::server::web::WebConfig;
use localsend::http::server::{ServerConfigV2, TlsConfig, start_with_port};
use localsend::http::state::ClientInfo;
use localsend::model::discovery::{
    DeviceType, PROTOCOL_VERSION_V2, ProtocolType,
};
use localsend::model::transfer::{FileContent, FileDto, FileMetadata};
use localsend::multicast::{
    DEFAULT_MULTICAST_GROUP, DEFAULT_MULTICAST_GROUP_V6, DEFAULT_PORT, MulticastDevice,
};
use localsend::reqwest;
use localsend::util::filename::{Rules, sanitize};
use localsend::util::interface::{InterfaceFilter, local_interface_addresses};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::{mpsc, oneshot};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;
use walkdir::WalkDir;

#[derive(Clone)]
struct Identity {
    alias: String,
    port: u16,
    cert_pem: String,
    key_pem: String,
    fingerprint: String,
}

impl Identity {
    fn load_or_generate(dir: &Path, alias: String, port: u16) -> anyhow::Result<Self> {
        std::fs::create_dir_all(dir)?;
        let path = dir.join("identity.pem");
        match std::fs::read_to_string(&path) {
            Ok(text) => Self::from_pem(&text, alias, port)
                .with_context(|| format!("Invalid identity file: {}", path.display())),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let cert = localsend::crypto::cert::generate_self_signed()?;
                let identity = Self {
                    alias,
                    port,
                    cert_pem: cert.certificate_pem,
                    key_pem: cert.private_key_pem,
                    fingerprint: cert.fingerprint,
                };
                std::fs::write(&path, format!("{}{}", identity.cert_pem, identity.key_pem))?;
                Ok(identity)
            }
            Err(error) => Err(error.into()),
        }
    }

    fn from_pem(text: &str, alias: String, port: u16) -> anyhow::Result<Self> {
        let blocks = pem::parse_many(text)?;
        let cert = blocks
            .iter()
            .find(|block| block.tag() == "CERTIFICATE")
            .context("missing CERTIFICATE block")?;
        let key = blocks
            .iter()
            .find(|block| block.tag().ends_with("PRIVATE KEY"))
            .context("missing PRIVATE KEY block")?;
        let key_pem = pem::encode(key);
        rcgen::KeyPair::from_pem(&key_pem).context("unusable private key")?;
        Ok(Self {
            alias,
            port,
            cert_pem: pem::encode(cert),
            key_pem,
            fingerprint: fingerprint_from_cert_der(cert.contents()),
        })
    }

    fn tls_config(&self) -> TlsConfig {
        TlsConfig {
            cert: self.cert_pem.clone(),
            private_key: self.key_pem.clone(),
        }
    }

    fn client_info(&self) -> ClientInfo {
        ClientInfo {
            alias: self.alias.clone(),
            version: PROTOCOL_VERSION_V2.to_string(),
            device_model: Some("Tianchuang Cloud".to_string()),
            device_type: Some(DeviceType::Desktop),
            token: self.fingerprint.clone(),
        }
    }

    fn register_dto(&self) -> RegisterDtoV2 {
        RegisterDtoV2 {
            alias: self.alias.clone(),
            version: PROTOCOL_VERSION_V2.to_string(),
            device_model: Some("Tianchuang Cloud".to_string()),
            device_type: Some(DeviceType::Desktop),
            fingerprint: self.fingerprint.clone(),
            port: self.port,
            protocol: ProtocolType::Https,
            download: false,
        }
    }

    fn multicast_device(&self) -> MulticastDevice {
        MulticastDevice {
            alias: self.alias.clone(),
            version: PROTOCOL_VERSION_V2.to_string(),
            device_model: Some("Tianchuang Cloud".to_string()),
            device_type: Some(DeviceType::Desktop),
            fingerprint: self.fingerprint.clone(),
            port: self.port,
            protocol: ProtocolType::Https,
            download: false,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Command {
    Refresh,
    Probe { host: String, port: u16 },
    SendText {
        transfer_id: String,
        fingerprint: String,
        text: String,
    },
    SendFiles {
        transfer_id: String,
        fingerprint: String,
        paths: Vec<PathBuf>,
    },
    Answer {
        session_id: String,
        accept: bool,
        destination: Option<PathBuf>,
    },
    Cancel { transfer_id: String },
    Shutdown,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Output<'a> {
    Ready {
        alias: &'a str,
        port: u16,
        fingerprint: &'a str,
    },
    Devices { devices: Vec<DeviceView> },
    ReceiveRequest {
        session_id: &'a str,
        alias: &'a str,
        fingerprint: &'a str,
        files: Vec<FileView>,
        total_bytes: u64,
    },
    TextReceived {
        alias: &'a str,
        fingerprint: &'a str,
        text: &'a str,
    },
    TransferStarted {
        transfer_id: &'a str,
        direction: &'a str,
        total_bytes: u64,
    },
    TransferProgress {
        transfer_id: &'a str,
        direction: &'a str,
        transferred_bytes: u64,
        total_bytes: u64,
    },
    TransferComplete {
        transfer_id: &'a str,
        direction: &'a str,
        success: bool,
        message: &'a str,
    },
    FileReceived {
        session_id: &'a str,
        path: String,
        success: bool,
        message: &'a str,
    },
    Error { command: &'a str, message: String },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceView {
    alias: String,
    fingerprint: String,
    model: Option<String>,
    device_type: String,
    host: Option<String>,
    port: Option<u16>,
    protocol: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileView {
    id: String,
    name: String,
    size: u64,
    file_type: String,
}

fn emit(output: Output<'_>) {
    match serde_json::to_string(&output) {
        Ok(line) => println!("{line}"),
        Err(error) => eprintln!("Could not serialize sidecar event: {error}"),
    }
}

fn emit_error(command: &str, error: impl std::fmt::Display) {
    emit(Output::Error {
        command,
        message: error.to_string(),
    });
}

struct Args {
    data_dir: PathBuf,
    destination: PathBuf,
    alias: String,
    port: u16,
}

fn parse_args() -> anyhow::Result<Args> {
    let mut data_dir = None;
    let mut destination = None;
    let mut alias = "天创云端".to_string();
    let mut port = DEFAULT_PORT;
    let mut args = std::env::args().skip(1);
    while let Some(name) = args.next() {
        let value = args.next().ok_or_else(|| anyhow!("Missing value for {name}"))?;
        match name.as_str() {
            "--data-dir" => data_dir = Some(PathBuf::from(value)),
            "--destination" => destination = Some(PathBuf::from(value)),
            "--alias" => alias = value,
            "--port" => port = value.parse().context("Invalid --port")?,
            _ => return Err(anyhow!("Unknown argument {name}")),
        }
    }
    Ok(Args {
        data_dir: data_dir.context("--data-dir is required")?,
        destination: destination.context("--destination is required")?,
        alias,
        port,
    })
}

#[derive(Clone)]
enum FileSource {
    Path(PathBuf),
    Bytes(Bytes),
}

struct PendingReceive {
    files: HashMap<String, FileDto>,
    decision_tx: oneshot::Sender<PrepareUploadDecisionV2>,
}

struct ReceiveSession {
    destination: PathBuf,
    total_bytes: u64,
    transferred: Arc<AtomicU64>,
}

struct ActiveSend {
    transfer_id: String,
    total_bytes: u64,
    transferred: Arc<AtomicU64>,
    cancel: CancellationToken,
    peer_cancelled: Arc<AtomicBool>,
    session_id: Option<String>,
    host: String,
}

enum InternalEvent {
    SendSession { transfer_id: String, session_id: String, total_bytes: u64 },
    SendComplete { transfer_id: String, success: bool, message: String },
    ReceiveComplete { session_id: String, final_path: PathBuf, success: bool, message: String },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = parse_args()?;
    std::fs::create_dir_all(&args.destination)?;
    let identity = Arc::new(Identity::load_or_generate(
        &args.data_dir,
        args.alias,
        args.port,
    )?);

    let (server_tx, mut server_rx) = mpsc::channel::<ServerEventV2>(32);
    let (server_stop_tx, server_stop_rx) = oneshot::channel::<()>();
    let server = Arc::new(
        start_with_port(
            identity.port,
            Some(identity.tls_config()),
            identity.client_info(),
            None,
            Some(ServerConfigV2 {
                pin: None,
                verify_checksums: true,
                event_tx: server_tx,
            }),
            WebConfig::default(),
            server_stop_rx,
        )
        .await?,
    );

    let (discovery_tx, mut discovery_rx) = mpsc::channel::<DiscoveryEvent>(32);
    let (discovery_stop_tx, discovery_stop_rx) = oneshot::channel::<()>();
    let discovery = Arc::new(
        localsend::discovery::start(
            DiscoveryConfig {
                group: DEFAULT_MULTICAST_GROUP,
                group_v6: Some(DEFAULT_MULTICAST_GROUP_V6),
                port: DEFAULT_PORT,
                interface_filter: InterfaceFilter::default(),
                device: identity.multicast_device(),
                identity: DeviceIdentity {
                    cert_pem: identity.cert_pem.clone(),
                    private_key_pem: identity.key_pem.clone(),
                },
                timeout: DEFAULT_DISCOVERY_TIMEOUT,
                event_tx: Some(discovery_tx),
            },
            discovery_stop_rx,
        )
        .await,
    );

    let (command_tx, mut command_rx) = mpsc::channel::<Command>(32);
    tokio::spawn(async move {
        let mut lines = BufReader::new(tokio::io::stdin()).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) if !line.trim().is_empty() => match serde_json::from_str(&line) {
                    Ok(command) => {
                        if command_tx.send(command).await.is_err() {
                            break;
                        }
                    }
                    Err(error) => emit_error("parse", error),
                },
                Ok(Some(_)) => {}
                Ok(None) | Err(_) => {
                    let _ = command_tx.send(Command::Shutdown).await;
                    break;
                }
            }
        }
    });

    let (internal_tx, mut internal_rx) = mpsc::channel::<InternalEvent>(64);
    let mut pending: HashMap<String, PendingReceive> = HashMap::new();
    let mut receiving: HashMap<String, ReceiveSession> = HashMap::new();
    let mut active_send: Option<ActiveSend> = None;
    let mut tick = tokio::time::interval(Duration::from_millis(250));

    emit(Output::Ready {
        alias: &identity.alias,
        port: identity.port,
        fingerprint: &identity.fingerprint,
    });
    spawn_refresh(discovery.clone(), identity.port);

    let mut shutdown = false;
    while !shutdown {
        tokio::select! {
            Some(command) = command_rx.recv() => {
                match command {
                    Command::Refresh => spawn_refresh(discovery.clone(), identity.port),
                    Command::Probe { host, port } => {
                        match discovery.discover(&host, port, ProtocolType::Https).await {
                            Ok(_) => emit_devices(&discovery),
                            Err(error) => emit_error("probe", error),
                        }
                    }
                    Command::SendText { transfer_id, fingerprint, text } => {
                        if active_send.is_some() {
                            emit_error("send_text", "Another send is already active");
                            continue;
                        }
                        match discovery.device_by_fingerprint(&fingerprint) {
                            Some(device) => match build_text_transfer(text) {
                                Ok((files, sources, total)) => {
                                    match start_send(transfer_id, identity.clone(), device, files, sources, total, internal_tx.clone()) {
                                        Ok(send) => active_send = Some(send),
                                        Err(error) => emit_error("send_text", error),
                                    }
                                }
                                Err(error) => emit_error("send_text", error),
                            },
                            None => emit_error("send_text", "Device is no longer available"),
                        }
                    }
                    Command::SendFiles { transfer_id, fingerprint, paths } => {
                        if active_send.is_some() {
                            emit_error("send_files", "Another send is already active");
                            continue;
                        }
                        match (discovery.device_by_fingerprint(&fingerprint), build_file_transfer(paths)) {
                            (Some(device), Ok((files, sources, total))) => {
                                match start_send(transfer_id, identity.clone(), device, files, sources, total, internal_tx.clone()) {
                                    Ok(send) => active_send = Some(send),
                                    Err(error) => emit_error("send_files", error),
                                }
                            }
                            (None, _) => emit_error("send_files", "Device is no longer available"),
                            (_, Err(error)) => emit_error("send_files", error),
                        }
                    }
                    Command::Answer { session_id, accept, destination } => {
                        let Some(request) = pending.remove(&session_id) else {
                            emit_error("answer", "Receive request has expired");
                            continue;
                        };
                        if !accept {
                            let _ = request.decision_tx.send(PrepareUploadDecisionV2::Decline);
                            continue;
                        }
                        let destination = destination.unwrap_or_else(|| args.destination.clone());
                        match std::fs::create_dir_all(&destination) {
                            Ok(()) => {
                                let ids = request.files.keys().cloned().collect::<HashSet<_>>();
                                if request.decision_tx.send(PrepareUploadDecisionV2::Accept(ids)).is_ok() {
                                    let total = request.files.values().map(|file| file.size).sum();
                                    receiving.insert(session_id.clone(), ReceiveSession { destination, total_bytes: total, transferred: Arc::new(AtomicU64::new(0)) });
                                    emit(Output::TransferStarted { transfer_id: &session_id, direction: "receive", total_bytes: total });
                                }
                            }
                            Err(error) => emit_error("answer", error),
                        }
                    }
                    Command::Cancel { transfer_id } => {
                        if let Some(send) = active_send.as_ref().filter(|send| send.transfer_id == transfer_id) {
                            send.cancel.cancel();
                        } else if receiving.contains_key(&transfer_id) {
                            server.cancel_v2_session(&transfer_id).await;
                        } else {
                            emit_error("cancel", "Transfer is not active");
                        }
                    }
                    Command::Shutdown => shutdown = true,
                }
            }
            Some(event) = server_rx.recv() => {
                handle_server_event(
                    event,
                    &identity,
                    &discovery,
                    &server,
                    &mut pending,
                    &mut receiving,
                    &mut active_send,
                    &internal_tx,
                ).await;
            }
            Some(_) = discovery_rx.recv() => emit_devices(&discovery),
            Some(event) = internal_rx.recv() => {
                match event {
                    InternalEvent::SendSession { transfer_id, session_id, total_bytes } => {
                        if let Some(send) = active_send.as_mut().filter(|send| send.transfer_id == transfer_id) {
                            send.session_id = Some(session_id);
                            send.total_bytes = total_bytes;
                        }
                    }
                    InternalEvent::SendComplete { transfer_id, success, message } => {
                        emit(Output::TransferComplete { transfer_id: &transfer_id, direction: "send", success, message: &message });
                        if active_send.as_ref().is_some_and(|send| send.transfer_id == transfer_id) {
                            active_send = None;
                        }
                    }
                    InternalEvent::ReceiveComplete { session_id, final_path, success, message } => {
                        emit(Output::FileReceived { session_id: &session_id, path: final_path.to_string_lossy().into_owned(), success, message: &message });
                    }
                }
            }
            _ = tick.tick() => {
                if let Some(send) = &active_send {
                    emit(Output::TransferProgress {
                        transfer_id: &send.transfer_id,
                        direction: "send",
                        transferred_bytes: send.transferred.load(Ordering::Relaxed),
                        total_bytes: send.total_bytes,
                    });
                }
                for (session_id, receive) in &receiving {
                    emit(Output::TransferProgress {
                        transfer_id: session_id,
                        direction: "receive",
                        transferred_bytes: receive.transferred.load(Ordering::Relaxed),
                        total_bytes: receive.total_bytes,
                    });
                }
            }
        }
    }

    if let Some(send) = &active_send {
        send.cancel.cancel();
    }
    let _ = server_stop_tx.send(());
    let _ = discovery_stop_tx.send(());
    let _ = tokio::time::timeout(Duration::from_secs(2), server.wait_stopped()).await;
    let _ = tokio::time::timeout(Duration::from_secs(2), discovery.wait_stopped()).await;
    Ok(())
}

fn spawn_refresh(discovery: Arc<DiscoveryHandle>, port: u16) {
    let ips = local_interface_addresses(&InterfaceFilter::default()).unwrap_or_default();
    tokio::spawn(async move {
        let _ = discovery
            .discover_staged(Vec::new(), ips, port, ProtocolType::Https, Duration::from_secs(1))
            .await;
    });
}

fn emit_devices(discovery: &DiscoveryHandle) {
    let devices = discovery
        .devices()
        .into_iter()
        .map(|stored| {
            let http = stored
                .get_best_channel()
                .and_then(|channel| channel.http())
                .cloned();
            DeviceView {
                alias: stored.device.alias,
                fingerprint: stored.device.fingerprint,
                model: stored.device.device_model,
                device_type: format!("{:?}", stored.device.device_type.unwrap_or(DeviceType::Desktop)).to_ascii_lowercase(),
                host: http.as_ref().map(|channel| channel.host.clone()),
                port: http.as_ref().map(|channel| channel.port),
                protocol: http.as_ref().map(|channel| channel.protocol.as_str().to_string()),
            }
        })
        .collect();
    emit(Output::Devices { devices });
}

fn build_text_transfer(text: String) -> anyhow::Result<(HashMap<String, FileDto>, HashMap<String, FileSource>, u64)> {
    anyhow::ensure!(!text.is_empty(), "Text is empty");
    anyhow::ensure!(text.len() <= 16_000_000, "Text is larger than 16 MB");
    let id = Uuid::new_v4().to_string();
    let bytes = Bytes::from(text.clone());
    let size = bytes.len() as u64;
    let preview = (bytes.len() <= 64_000).then_some(text);
    let file = FileDto {
        id: id.clone(),
        file_name: format!("{id}.txt"),
        size,
        file_type: "text/plain".to_string(),
        sha256: None,
        preview,
        metadata: None,
    };
    Ok((HashMap::from([(id.clone(), file)]), HashMap::from([(id, FileSource::Bytes(bytes))]), size))
}

fn build_file_transfer(paths: Vec<PathBuf>) -> anyhow::Result<(HashMap<String, FileDto>, HashMap<String, FileSource>, u64)> {
    anyhow::ensure!(!paths.is_empty(), "No files selected");
    let mut files = HashMap::new();
    let mut sources = HashMap::new();
    let mut total = 0u64;
    for selected in paths {
        let collected = collect_paths(&selected)?;
        for (path, name) in collected {
            let metadata = std::fs::metadata(&path)?;
            if !metadata.is_file() {
                continue;
            }
            let id = Uuid::new_v4().to_string();
            total = total.saturating_add(metadata.len());
            files.insert(id.clone(), FileDto {
                id: id.clone(),
                file_name: name,
                size: metadata.len(),
                file_type: mime_guess::from_path(&path).first_or_octet_stream().to_string(),
                sha256: None,
                preview: None,
                metadata: FileMetadata::from_fs_metadata(&metadata),
            });
            sources.insert(id, FileSource::Path(path));
        }
    }
    anyhow::ensure!(!files.is_empty(), "No readable files selected");
    Ok((files, sources, total))
}

fn collect_paths(path: &Path) -> anyhow::Result<Vec<(PathBuf, String)>> {
    let metadata = std::fs::metadata(path)?;
    if metadata.is_file() {
        let name = path.file_name().context("File has no name")?.to_string_lossy().into_owned();
        return Ok(vec![(path.to_path_buf(), name)]);
    }
    anyhow::ensure!(metadata.is_dir(), "Path is not a file or directory");
    let root = path.file_name().context("Directory has no name")?.to_string_lossy().into_owned();
    let mut result = Vec::new();
    for entry in WalkDir::new(path).min_depth(1).sort_by_file_name() {
        let entry = entry?;
        if !entry.file_type().is_file() {
            continue;
        }
        let relative = entry.path().strip_prefix(path)?;
        let name = std::iter::once(root.clone())
            .chain(relative.components().filter_map(|part| match part {
                Component::Normal(name) => Some(name.to_string_lossy().into_owned()),
                _ => None,
            }))
            .collect::<Vec<_>>()
            .join("/");
        result.push((entry.path().to_path_buf(), name));
    }
    Ok(result)
}

fn start_send(
    transfer_id: String,
    identity: Arc<Identity>,
    device: StatefulDevice,
    files: HashMap<String, FileDto>,
    sources: HashMap<String, FileSource>,
    total_bytes: u64,
    events: mpsc::Sender<InternalEvent>,
) -> anyhow::Result<ActiveSend> {
    let http = device.get_best_channel().and_then(|channel| channel.http()).context("Device has no reachable HTTP address")?.clone();
    let transferred = Arc::new(AtomicU64::new(0));
    let cancel = CancellationToken::new();
    let peer_cancelled = Arc::new(AtomicBool::new(false));
    let state = ActiveSend {
        transfer_id: transfer_id.clone(),
        total_bytes,
        transferred: transferred.clone(),
        cancel: cancel.clone(),
        peer_cancelled: peer_cancelled.clone(),
        session_id: None,
        host: http.host.clone(),
    };
    emit(Output::TransferStarted { transfer_id: &transfer_id, direction: "send", total_bytes });
    tokio::spawn(async move {
        let result = send_transfer(&transfer_id, identity, device, files, sources, transferred, cancel, peer_cancelled, &events).await;
        let (success, message) = match result {
            Ok(message) => (true, message),
            Err(error) => (false, error.to_string()),
        };
        let _ = events.send(InternalEvent::SendComplete { transfer_id, success, message }).await;
    });
    Ok(state)
}

async fn send_transfer(
    transfer_id: &str,
    identity: Arc<Identity>,
    device: StatefulDevice,
    files: HashMap<String, FileDto>,
    mut sources: HashMap<String, FileSource>,
    progress: Arc<AtomicU64>,
    cancel: CancellationToken,
    peer_cancelled: Arc<AtomicBool>,
    events: &mpsc::Sender<InternalEvent>,
) -> anyhow::Result<String> {
    let http = device.get_best_channel().and_then(|channel| channel.http()).context("No dialable address")?;
    let expected = (http.protocol == ProtocolType::Https).then(|| device.device.fingerprint.clone());
    let client = LsHttpClientV2::try_new(&identity.key_pem, &identity.cert_pem, expected, None)?;
    let offered = files.len();
    let is_message = offered == 1 && files.values().all(|file| file.preview.is_some());
    let prepared = client.prepare_upload(
        http.protocol,
        &http.host,
        http.port,
        None,
        PrepareUploadRequestDtoV2 { info: identity.register_dto(), files: files.clone() },
        None,
        cancel.clone(),
    ).await.map_err(format_client_error)?;
    let Some(response) = prepared.response else {
        anyhow::ensure!(is_message, "Receiver declined every file");
        return Ok("Text sent".to_string());
    };
    anyhow::ensure!(prepared.status_code == 200 && !response.session_id.is_empty(), "Invalid prepare response");
    let accepted_bytes = response.files.keys().filter_map(|id| files.get(id)).map(|file| file.size).sum();
    let _ = events.send(InternalEvent::SendSession {
        transfer_id: transfer_id.to_string(),
        session_id: response.session_id.clone(),
        total_bytes: accepted_bytes,
    }).await;
    let mut ids = response.files.keys().cloned().collect::<Vec<_>>();
    ids.sort_by_key(|id| files.get(id).map(|file| file.file_name.clone()).unwrap_or_default());
    let mut sent = 0u64;
    for id in ids {
        let file = files.get(&id).context("Receiver accepted an unknown file")?;
        let token = response.files.get(&id).context("Missing upload token")?;
        let content = match sources.remove(&id).context("Missing file source")? {
            FileSource::Path(path) => FileContent::Path(path),
            FileSource::Bytes(bytes) => {
                let (tx, rx) = mpsc::channel(1);
                let _ = tx.try_send(bytes);
                FileContent::Stream(rx)
            }
        };
        let mut file_sent = 0u64;
        let base = sent;
        let progress_ref = progress.clone();
        let stream = content.into_stream().map(move |chunk| {
            let chunk = chunk?;
            file_sent += chunk.len() as u64;
            progress_ref.store(base + file_sent, Ordering::Relaxed);
            Ok::<Bytes, anyhow::Error>(chunk)
        });
        let body = reqwest::Body::wrap_stream(stream);
        match client.upload(http.protocol, &http.host, http.port, None, &response.session_id, &id, token, body, cancel.clone()).await {
            Ok(()) => {
                sent = sent.saturating_add(file.size);
                progress.store(sent, Ordering::Relaxed);
            }
            Err(ClientError::Cancelled) => {
                if !peer_cancelled.load(Ordering::Relaxed) {
                    let _ = client.cancel(http.protocol, &http.host, http.port, &response.session_id).await;
                }
                return Err(anyhow!("Transfer cancelled"));
            }
            Err(error) => {
                let _ = client.cancel(http.protocol, &http.host, http.port, &response.session_id).await;
                return Err(format_client_error(error));
            }
        }
    }
    Ok(if is_message { "Text sent".to_string() } else { format!("Sent {} file(s)", response.files.len()) })
}

fn format_client_error(error: ClientError) -> anyhow::Error {
    match error {
        ClientError::StatusCode(status) => anyhow!("Remote returned status {}{}", status.status, status.message.map(|message| format!(": {message}")).unwrap_or_default()),
        other => anyhow!(other.to_string()),
    }
}

#[allow(clippy::too_many_arguments)]
async fn handle_server_event(
    event: ServerEventV2,
    identity: &Identity,
    discovery: &Arc<DiscoveryHandle>,
    _server: &Arc<localsend::http::server::ServerHandle>,
    pending: &mut HashMap<String, PendingReceive>,
    receiving: &mut HashMap<String, ReceiveSession>,
    active_send: &mut Option<ActiveSend>,
    internal: &mpsc::Sender<InternalEvent>,
) {
    match event {
        ServerEventV2::Register { ip, info } => {
            if info.fingerprint != identity.fingerprint {
                let device = DiscoveredDevice {
                    alias: info.alias,
                    version: info.version,
                    device_model: info.device_model,
                    device_type: info.device_type,
                    fingerprint: info.fingerprint,
                    channel: DeviceChannel::Http(localsend::discovery::HttpChannel {
                        host: ip.to_string(),
                        port: info.port,
                        protocol: info.protocol,
                    }),
                    download: info.download,
                };
                discovery.add_device(device).await;
                emit_devices(discovery);
            }
        }
        ServerEventV2::PrepareUpload { session_id, ip: _, info, cert_fingerprint, files, decision_tx } => {
            let fingerprint = cert_fingerprint.unwrap_or_else(|| info.fingerprint.clone());
            if files.len() == 1 {
                if let Some(text) = files.values().next().and_then(|file| file.preview.as_deref()) {
                    let _ = decision_tx.send(PrepareUploadDecisionV2::Accept(HashSet::new()));
                    emit(Output::TextReceived { alias: &info.alias, fingerprint: &fingerprint, text });
                    return;
                }
            }
            let total_bytes = files.values().map(|file| file.size).sum();
            let views = files.values().map(|file| FileView {
                id: file.id.clone(), name: file.file_name.clone(), size: file.size, file_type: file.file_type.clone(),
            }).collect();
            emit(Output::ReceiveRequest { session_id: &session_id, alias: &info.alias, fingerprint: &fingerprint, files: views, total_bytes });
            pending.insert(session_id, PendingReceive { files, decision_tx });
        }
        ServerEventV2::FileUpload { session_id, file_id: _, file, target_tx } => {
            let Some(session) = receiving.get(&session_id) else { return; };
            let final_path = safe_receive_path(&session.destination, &file.file_name);
            if let Some(parent) = final_path.parent() {
                if let Err(error) = std::fs::create_dir_all(parent) {
                    emit_error("receive", error);
                    return;
                }
            }
            let temp_path = final_path.with_file_name(format!(".tc-localsend-{}.part", Uuid::new_v4()));
            let (result_tx, result_rx) = oneshot::channel();
            let (progress_tx, mut progress_rx) = mpsc::channel(8);
            if target_tx.send(FileUploadTarget::Path { path: temp_path.clone(), result_tx, progress_tx: Some(progress_tx) }).is_err() {
                return;
            }
            let internal = internal.clone();
            let transferred = session.transferred.clone();
            tokio::spawn(async move {
                let mut previous = 0u64;
                while let Some(written) = progress_rx.recv().await {
                    if written > previous {
                        transferred.fetch_add(written - previous, Ordering::Relaxed);
                        previous = written;
                    }
                }
            });
            tokio::spawn(async move {
                let (success, message) = match result_rx.await {
                    Ok(Ok(())) => match rename_unique(&temp_path, &final_path) {
                        Ok(actual) => {
                            let _ = internal.send(InternalEvent::ReceiveComplete { session_id, final_path: actual, success: true, message: "File received".to_string() }).await;
                            return;
                        }
                        Err(error) => (false, error.to_string()),
                    },
                    Ok(Err(error)) => (false, error),
                    Err(_) => (false, "Receive stream ended unexpectedly".to_string()),
                };
                let _ = std::fs::remove_file(&temp_path);
                let _ = internal.send(InternalEvent::ReceiveComplete { session_id, final_path, success, message }).await;
            });
        }
        ServerEventV2::SessionEnd { session_id, reason } => {
            let completed = receiving.remove(&session_id);
            let Some(receive) = completed else { return; };
            let cancelled = reason == SessionEndReasonV2::Cancelled;
            if !cancelled { receive.transferred.store(receive.total_bytes, Ordering::Relaxed); }
            emit(Output::TransferComplete {
                transfer_id: &session_id,
                direction: "receive",
                success: !cancelled,
                message: if cancelled { "Sender cancelled" } else { "Files received" },
            });
        }
        ServerEventV2::PrepareUploadAborted { session_id } => {
            pending.remove(&session_id);
        }
        ServerEventV2::CancelReceived { ip, session_id } => {
            if let Some(send) = active_send.as_ref().filter(|send| send.session_id.as_deref() == Some(session_id.as_str()) && send.host == ip.to_string()) {
                send.peer_cancelled.store(true, Ordering::Relaxed);
                send.cancel.cancel();
            }
        }
        ServerEventV2::ListenerFailed { error } => emit_error("listener", error),
    }
}

fn safe_receive_path(destination: &Path, remote_name: &str) -> PathBuf {
    let segments = remote_name
        .split(['/', '\\'])
        .filter(|segment| !segment.is_empty() && *segment != "." && *segment != "..")
        .map(|segment| sanitize(segment, Rules::current()))
        .collect::<Vec<_>>();
    let mut path = destination.to_path_buf();
    if segments.is_empty() {
        path.push("untitled");
    } else {
        for segment in segments {
            path.push(segment);
        }
    }
    path
}

fn rename_unique(temp: &Path, requested: &Path) -> anyhow::Result<PathBuf> {
    let mut candidate = requested.to_path_buf();
    let stem = requested.file_stem().and_then(|value| value.to_str()).unwrap_or("file");
    let extension = requested.extension().and_then(|value| value.to_str());
    for index in 0..10_000u32 {
        if index > 0 {
            let name = match extension {
                Some(extension) => format!("{stem} ({index}).{extension}"),
                None => format!("{stem} ({index})"),
            };
            candidate.set_file_name(name);
        }
        if !candidate.exists() {
            std::fs::rename(temp, &candidate)?;
            return Ok(candidate);
        }
    }
    Err(anyhow!("Could not allocate a unique receive path"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn receive_path_cannot_escape_destination() {
        let destination = PathBuf::from("C:/safe/downloads");
        let result = safe_receive_path(&destination, "../../课程/../笔记.txt");
        assert!(result.starts_with(&destination));
        assert_eq!(result, destination.join("课程").join("笔记.txt"));
    }

    #[test]
    fn unique_rename_preserves_existing_file() {
        let root = std::env::temp_dir().join(format!("tc-localsend-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let requested = root.join("课程笔记.txt");
        let temporary = root.join("upload.part");
        std::fs::write(&requested, "old").unwrap();
        std::fs::write(&temporary, "new").unwrap();
        let actual = rename_unique(&temporary, &requested).unwrap();
        assert_eq!(std::fs::read_to_string(&requested).unwrap(), "old");
        assert_eq!(std::fs::read_to_string(&actual).unwrap(), "new");
        assert_eq!(actual.file_name().unwrap(), "课程笔记 (1).txt");
        std::fs::remove_dir_all(root).unwrap();
    }
}

