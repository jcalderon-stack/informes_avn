/**
 * Backend completo de la app "Relevamiento de Racks": guarda los PDF en Drive
 * (uno por rack + informes ejecutivos), registra todo en una planilla de
 * seguimiento, y además funciona como base de datos de la app (login,
 * correos autorizados, configuración y los relevamientos en sí), guardando
 * todo como archivos dentro de la carpeta principal. Esto permite publicar
 * la app como un sitio propio (fuera de Claude) sin perder nada de datos.
 *
 * Carpeta destino:
 * https://drive.google.com/drive/folders/1xRxDPpYK_28NGAY8ChwXHzoYDrp7SzrB
 */
var FOLDER_ID = "1xRxDPpYK_28NGAY8ChwXHzoYDrp7SzrB";
var TRACKING_SHEET_NAME = "Registro de Relevamientos - AVN";
var DATA_FOLDER_NAME = "Datos de la App (no borrar)";
var REPORTS_FOLDER_NAME = "Relevamientos (datos)";
var CONFIG_FILE_NAME = "config.json";

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    // Acciones de la capa de datos de la app (config y relevamientos)
    if (data.action) {
      return handleAction(data);
    }

    // Comportamiento por defecto: subir un PDF (informe de rack o ejecutivo)
    return handlePdfUpload(data);
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  return jsonResponse({ ok: true, message: "Servicio de guardado en Drive activo" });
}

/* ============ SUBIDA DE PDF (informes de rack / ejecutivos) ============ */
function handlePdfUpload(data) {
  var filename = data.filename || ("Informe_" + new Date().getTime() + ".pdf");
  var base64 = data.pdfBase64;

  if (!base64) {
    return jsonResponse({ ok: false, error: "Falta el PDF (pdfBase64)" });
  }

  var mainFolder = DriveApp.getFolderById(FOLDER_ID);
  var bytes = Utilities.base64Decode(base64);
  var blob = Utilities.newBlob(bytes, "application/pdf", filename);

  if (data.type === "executive") {
    // Informe ejecutivo entregable al cliente: se guarda en su propia carpeta
    var execFolder = getOrCreateSubfolder(mainFolder, "Informes Ejecutivos");
    var execFile = execFolder.createFile(blob);

    var sheetInfoExec = getOrCreateTrackingSheet(mainFolder);
    sheetInfoExec.sheet.appendRow([
      new Date(),
      "",
      data.usuario || "",
      data.rol || "",
      "",
      "(Informe Ejecutivo)",
      "",
      "",
      "",
      data.dateLabel || "",
      filename,
      execFile.getUrl(),
      execFolder.getUrl()
    ]);

    return jsonResponse({
      ok: true,
      fileId: execFile.getId(),
      url: execFile.getUrl(),
      filename: filename,
      rackFolderUrl: execFolder.getUrl(),
      trackingSheetUrl: sheetInfoExec.url
    });
  }

  // 1) Obtener (o crear) la subcarpeta con el nombre del rack
  var rackFolderName = (data.nombreRack || data.etiquetaRack || "SIN_NOMBRE").toString().trim() || "SIN_NOMBRE";
  var rackFolder = getOrCreateSubfolder(mainFolder, rackFolderName);

  // 2) Guardar el PDF dentro de esa subcarpeta
  var file = rackFolder.createFile(blob);

  // 3) Registrar el informe en la planilla de seguimiento (en la carpeta principal)
  var sheetInfo = getOrCreateTrackingSheet(mainFolder);
  sheetInfo.sheet.appendRow([
    new Date(),
    data.tecnico || "",
    data.usuario || "",
    data.rol || "",
    data.numeroControl || "",
    data.nombreRack || "",
    data.etiquetaRack || "",
    data.ubicacion || "",
    data.empresa || "",
    data.fechaInforme || "",
    filename,
    file.getUrl(),
    rackFolder.getUrl()
  ]);

  return jsonResponse({
    ok: true,
    fileId: file.getId(),
    url: file.getUrl(),
    filename: filename,
    rackFolderUrl: rackFolder.getUrl(),
    trackingSheetUrl: sheetInfo.url
  });
}

/* ============ CAPA DE DATOS DE LA APP (config + relevamientos) ============ */
function handleAction(data) {
  switch (data.action) {
    case "configGet":
      return jsonResponse({ ok: true, value: getConfigValue(data.key) });
    case "configSet":
      setConfigValue(data.key, data.value);
      return jsonResponse({ ok: true });
    case "reportsList":
      return jsonResponse({ ok: true, reports: listReportsFromDrive() });
    case "reportSave":
      saveReportToDrive(data.id, data.json);
      return jsonResponse({ ok: true });
    case "reportDelete":
      deleteReportFromDrive(data.id);
      return jsonResponse({ ok: true });
    default:
      return jsonResponse({ ok: false, error: "Acción desconocida: " + data.action });
  }
}

function getDataFolder() {
  var main = DriveApp.getFolderById(FOLDER_ID);
  return getOrCreateSubfolder(main, DATA_FOLDER_NAME);
}

function getReportsFolder() {
  return getOrCreateSubfolder(getDataFolder(), REPORTS_FOLDER_NAME);
}

function getConfigFile() {
  var folder = getDataFolder();
  var it = folder.getFilesByName(CONFIG_FILE_NAME);
  if (it.hasNext()) return it.next();
  return folder.createFile(CONFIG_FILE_NAME, "{}", MimeType.PLAIN_TEXT);
}

function getConfigValue(key) {
  var file = getConfigFile();
  var obj = {};
  try { obj = JSON.parse(file.getBlob().getDataAsString() || "{}"); } catch (e) { obj = {}; }
  return obj[key] !== undefined ? obj[key] : "";
}

function setConfigValue(key, value) {
  var file = getConfigFile();
  var obj = {};
  try { obj = JSON.parse(file.getBlob().getDataAsString() || "{}"); } catch (e) { obj = {}; }
  obj[key] = value;
  file.setContent(JSON.stringify(obj));
}

function listReportsFromDrive() {
  var folder = getReportsFolder();
  var files = folder.getFiles();
  var out = [];
  while (files.hasNext()) {
    var f = files.next();
    try {
      out.push(JSON.parse(f.getBlob().getDataAsString()));
    } catch (e) {
      // archivo corrupto o vacío: se ignora
    }
  }
  return out;
}

function saveReportToDrive(id, jsonStr) {
  var folder = getReportsFolder();
  var name = id + ".json";
  var it = folder.getFilesByName(name);
  if (it.hasNext()) {
    it.next().setContent(jsonStr);
  } else {
    folder.createFile(name, jsonStr, MimeType.PLAIN_TEXT);
  }
}

function deleteReportFromDrive(id) {
  var folder = getReportsFolder();
  var it = folder.getFilesByName(id + ".json");
  if (it.hasNext()) it.next().setTrashed(true);
}

/**
 * Busca una subcarpeta por nombre dentro de la carpeta dada; si no existe, la crea.
 */
function getOrCreateSubfolder(parentFolder, name) {
  var existing = parentFolder.getFoldersByName(name);
  if (existing.hasNext()) {
    return existing.next();
  }
  return parentFolder.createFolder(name);
}

/**
 * Busca la planilla de seguimiento dentro de la carpeta; si no existe,
 * la crea con encabezados y la mueve a la carpeta.
 */
function getOrCreateTrackingSheet(folder) {
  var files = folder.getFilesByName(TRACKING_SHEET_NAME);
  var ss;

  if (files.hasNext()) {
    var existingFile = files.next();
    ss = SpreadsheetApp.openById(existingFile.getId());
  } else {
    ss = SpreadsheetApp.create(TRACKING_SHEET_NAME);
    var newFile = DriveApp.getFileById(ss.getId());
    folder.addFile(newFile);
    // Google crea el archivo también en la raíz de "Mi unidad"; lo sacamos de ahí.
    var root = DriveApp.getRootFolder();
    if (root.getFilesByName(TRACKING_SHEET_NAME).hasNext()) {
      root.removeFile(newFile);
    }

    var sheet = ss.getSheets()[0];
    sheet.setName("Informes");
    sheet.appendRow([
      "Fecha de registro",
      "Técnico",
      "Usuario (login)",
      "Rol",
      "N° Control",
      "Nombre de Rack",
      "Etiqueta de Rack",
      "Ubicación",
      "Empresa",
      "Fecha del informe",
      "Archivo PDF",
      "Link al PDF",
      "Carpeta del Rack"
    ]);
    sheet.getRange(1, 1, 1, 13).setFontWeight("bold").setBackground("#0A0A0A").setFontColor("#FFFFFF");
    sheet.setFrozenRows(1);
    for (var c = 1; c <= 13; c++) sheet.autoResizeColumn(c);
  }

  return { sheet: ss.getSheets()[0], url: ss.getUrl() };
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
