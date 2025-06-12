<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <title>Sistema WhatsApp Masivo - Cable Hogar</title>
    
    <!-- CSS Libraries -->
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/sweetalert2@11.7.3/dist/sweetalert2.min.css" rel="stylesheet">
    
    <!-- Custom CSS -->
    <link href="{{ asset('css/whatsapp-system.css') }}" rel="stylesheet">
</head>
<body>
    <!-- Panel de estadísticas en tiempo real -->
    <div id="realTimeStats" class="real-time-stats">
        <button type="button" class="close-btn" onclick="hideRealTimeStats()">
            <i class="fas fa-times"></i>
        </button>
        <div class="d-flex justify-content-between align-items-center mb-3">
            <h6 class="mb-0"><i class="fas fa-chart-line me-2"></i>Stats en Vivo</h6>
            <div class="badge bg-success">ACTIVO</div>
        </div>
        
        <div class="row text-center mb-3">
            <div class="col-6">
                <div class="text-success">
                    <i class="fas fa-check-circle"></i>
                    <div class="h5 mb-0" id="liveSent">0</div>
                    <small>Enviados</small>
                </div>
            </div>
            <div class="col-6">
                <div class="text-danger">
                    <i class="fas fa-times-circle"></i>
                    <div class="h5 mb-0" id="liveFailed">0</div>
                    <small>Fallidos</small>
                </div>
            </div>
        </div>
        
        <hr style="border-color: rgba(255,255,255,0.2);">
        
        <div class="mb-2">
            <small>Velocidad:</small>
            <div id="liveSpeed">
                <span class="speed-indicator speed-medium"></span>Calculando...
            </div>
        </div>
        
        <div class="mb-2">
            <small>Tiempo restante:</small>
            <div class="text-info" id="liveETA">--:--</div>
        </div>
        
        <div class="mb-2">
            <small>Progreso:</small>
            <div class="progress" style="height: 8px;">
                <div class="progress-bar bg-info" id="liveProgressBar" style="width: 0%"></div>
            </div>
        </div>
        
        <div class="text-center mt-3">
            <small class="text-muted">
                Lote <span id="currentBatch">0</span> de <span id="totalBatches">0</span>
            </small>
        </div>
    </div>

    <!-- Contenido principal -->
    <div class="container-fluid py-4">
        <div class="row">
            <div class="col-12">
                <div class="card shadow-lg border-0 fade-in">
                    <div class="card-header bg-primary text-white">
                        <div class="row align-items-center">
                            <div class="col-md-8">
                                <h3 class="mb-0">
                                    <i class="fab fa-whatsapp me-2"></i>
                                    Sistema de Mensajería WhatsApp Masivo
                                </h3>
                                <small class="opacity-75">Cable Hogar - Optimizado para hasta 10,000 mensajes</small>
                            </div>
                            <div class="col-md-4 text-md-end">
                                <div class="mt-2">
                                    <span id="connection-status" class="badge bg-light text-dark">
                                        <span class="status-indicator status-disconnected"></span>
                                        Verificando conexión...
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="card-body">
                        <!-- Navegación por pestañas -->
                        <ul class="nav nav-tabs" id="mainTabs" role="tablist">
                            <li class="nav-item" role="presentation">
                                <button class="nav-link active" id="single-tab" data-bs-toggle="tab" data-bs-target="#single" type="button">
                                    <i class="fas fa-comment me-2"></i>Mensaje Individual
                                </button>
                            </li>
                            <li class="nav-item" role="presentation">
                                <button class="nav-link" id="bulk-tab" data-bs-toggle="tab" data-bs-target="#bulk" type="button">
                                    <i class="fas fa-comments me-2"></i>Mensajes Masivos
                                </button>
                            </li>
                            <li class="nav-item" role="presentation">
                                <button class="nav-link" id="stats-tab" data-bs-toggle="tab" data-bs-target="#stats" type="button">
                                    <i class="fas fa-chart-bar me-2"></i>Estadísticas
                                </button>
                            </li>
                        </ul>

                        <div class="tab-content mt-4" id="mainTabsContent">
                            <!-- PESTAÑA: Mensaje Individual -->
                            <div class="tab-pane fade show active" id="single" role="tabpanel">
                                <div class="row">
                                    <div class="col-lg-8 mx-auto">
                                        <div class="card border-0 shadow">
                                            <div class="card-header bg-light">
                                                <h5 class="mb-0"><i class="fas fa-paper-plane me-2"></i>Enviar Mensaje Individual</h5>
                                            </div>
                                            <div class="card-body">
                                                <form id="singleMessageForm">
                                                    <div class="row">
                                                        <div class="col-md-6">
                                                            <div class="mb-3">
                                                                <label for="phone" class="form-label">
                                                                    <i class="fas fa-phone me-1"></i>Número de Teléfono
                                                                </label>
                                                                <input type="text" class="form-control" id="phone" 
                                                                       placeholder="593998765432" required>
                                                                <div class="form-text">
                                                                    <i class="fas fa-info-circle me-1"></i>
                                                                    Incluir código de país (ej: 593998765432)
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div class="col-md-6">
                                                            <div class="mb-3">
                                                                <label class="form-label">
                                                                    <i class="fas fa-eye me-1"></i>Vista Previa
                                                                </label>
                                                                <div class="alert alert-info">
                                                                    <i class="fab fa-whatsapp me-2"></i>
                                                                    El mensaje se enviará tal como aparece abajo
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div class="mb-3">
                                                        <label for="message" class="form-label">
                                                            <i class="fas fa-comment-dots me-1"></i>Mensaje
                                                        </label>
                                                        <textarea class="form-control" id="message" rows="6" required 
                                                                  placeholder="Escribe tu mensaje aquí..." maxlength="4000"></textarea>
                                                        <div class="form-text d-flex justify-content-between">
                                                            <span><i class="fas fa-info-circle me-1"></i>Máximo 4000 caracteres</span>
                                                            <span id="charCount">0/4000</span>
                                                        </div>
                                                    </div>
                                                    <div class="text-center">
                                                        <button type="submit" class="btn btn-success btn-lg" id="sendSingleBtn">
                                                            <i class="fas fa-paper-plane me-2"></i>Enviar Mensaje
                                                        </button>
                                                    </div>
                                                </form>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- PESTAÑA: Mensajes Masivos -->
                            <div class="tab-pane fade" id="bulk" role="tabpanel">
                                <!-- Información del sistema -->
                                <div class="batch-info">
                                    <div class="text-center mb-4">
                                        <h4><i class="fas fa-rocket me-2"></i>Sistema Optimizado para Grandes Volúmenes</h4>
                                        <p class="mb-0">Procesamiento inteligente por lotes con recuperación automática de errores</p>
                                    </div>
                                    <div class="row">
                                        <div class="col-md-3 col-6">
                                            <div class="stats-card">
                                                <div><i class="fas fa-users fa-2x mb-2"></i></div>
                                                <div>Capacidad</div>
                                                <div><strong>10,000+</strong></div>
                                            </div>
                                        </div>
                                        <div class="col-md-3 col-6">
                                            <div class="stats-card">
                                                <div><i class="fas fa-clock fa-2x mb-2"></i></div>
                                                <div>Velocidad</div>
                                                <div><strong>2-3 seg/msg</strong></div>
                                            </div>
                                        </div>
                                        <div class="col-md-3 col-6">
                                            <div class="stats-card">
                                                <div><i class="fas fa-layer-group fa-2x mb-2"></i></div>
                                                <div>Lotes</div>
                                                <div><strong>100 msgs/lote</strong></div>
                                            </div>
                                        </div>
                                        <div class="col-md-3 col-6">
                                            <div class="stats-card">
                                                <div><i class="fas fa-shield-alt fa-2x mb-2"></i></div>
                                                <div>Recuperación</div>
                                                <div><strong>Auto-retry</strong></div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div class="row">
                                    <!-- Panel de carga de Excel -->
                                    <div class="col-md-6">
                                        <div class="card border-0 shadow">
                                            <div class="card-header bg-light">
                                                <h5><i class="fas fa-file-excel me-2 text-success"></i>Cargar Archivo Excel</h5>
                                            </div>
                                            <div class="card-body">
                                                <form id="excelUploadForm" enctype="multipart/form-data">
                                                    <div class="mb-3">
                                                        <input type="file" class="form-control" id="excel_file" 
                                                               accept=".xlsx,.xls" required>
                                                        <div class="form-text">
                                                            <div class="row">
                                                                <div class="col-12">
                                                                    <strong><i class="fas fa-check text-success me-1"></i>Columnas requeridas:</strong> nombres, numero
                                                                </div>
                                                                <div class="col-12">
                                                                    <strong><i class="fas fa-plus text-info me-1"></i>Columna opcional:</strong> valor
                                                                </div>
                                                                <div class="col-12">
                                                                    <strong><i class="fas fa-limit text-warning me-1"></i>Límite:</strong> 10,000 contactos máximo
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div class="d-grid gap-2">
                                                        <button type="submit" class="btn btn-primary" id="uploadBtn">
                                                            <i class="fas fa-upload me-2"></i>Cargar y Procesar Contactos
                                                        </button>
                                                        <a href="/whatsapp/download-template" class="btn btn-outline-secondary btn-sm">
                                                            <i class="fas fa-download me-1"></i>Descargar Plantilla
                                                        </a>
                                                    </div>
                                                </form>

                                                <!-- Vista previa de contactos -->
                                                <div id="contactsPreview" style="display: none;" class="mt-4">
                                                    <hr>
                                                    <div class="d-flex justify-content-between align-items-center mb-3">
                                                        <h6 class="mb-0"><i class="fas fa-list me-2"></i>Contactos Cargados</h6>
                                                        <div>
                                                            <span class="badge bg-success me-2">
                                                                <i class="fas fa-users me-1"></i>
                                                                <span id="contactsCount">0</span> Total
                                                            </span>
                                                            <span class="badge bg-info">
                                                                <i class="fas fa-layer-group me-1"></i>
                                                                <span id="batchesCount">0</span> Lotes
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div class="contact-preview" id="contactsList"></div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <!-- Panel de plantilla de mensaje -->
                                    <div class="col-md-6">
                                        <div class="card border-0 shadow">
                                            <div class="card-header bg-light">
                                                <h5><i class="fas fa-edit me-2 text-primary"></i>Plantilla de Mensaje</h5>
                                            </div>
                                            <div class="card-body">
                                                <div class="mb-3">
                                                    <label for="messageTemplate" class="form-label">
                                                        <i class="fas fa-comment-dots me-1"></i>Mensaje Personalizable
                                                    </label>
                                                    <textarea class="form-control" id="messageTemplate" rows="12">📢📢 *COMUNICADO* 📢📢
Estimad@ cliente *{nombre}* de Cable Hogar

La *Planilla* 🧾 del *Mes* de *JUNIO* ya se encuentra disponible.

*_Fecha_* *_máxima_* de pago hasta el *3* de *JUNIO* 🗓️

*Por favor no responda a este mensaje es solo informativo, si usted ya realizó su pago omita este mensaje*

*Para mayor información se puede comunicar al número +593 96 847 1674*

*¡Le deseamos un excelente día 😊👌!*</textarea>
                                                    <div class="form-text">
                                                        <div class="alert alert-info p-2 mt-2">
                                                            <small>
                                                                <strong><i class="fas fa-magic me-1"></i>Variables disponibles:</strong><br>
                                                                <code>{nombre}</code> - Se reemplaza con el nombre del contacto<br>
                                                                <code>{valor}</code> - Se reemplaza con el valor/monto del contacto
                                                            </small>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div class="text-center">
                                                    <span id="templateCharCount" class="badge bg-secondary">0 caracteres</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <!-- Controles de configuración de lotes -->
                                <div class="batch-controls" id="batchControls" style="display: none;">
                                    <h5><i class="fas fa-cogs me-2"></i>Configuración Avanzada de Envío</h5>
                                    <div class="row">
                                        <div class="col-md-3">
                                            <label for="batchSize" class="form-label">
                                                <i class="fas fa-layer-group me-1"></i>Tamaño de Lote
                                            </label>
                                            <select class="form-select" id="batchSize">
                                                <option value="50">50 mensajes/lote</option>
                                                <option value="100" selected>100 mensajes/lote (Recomendado)</option>
                                                <option value="200">200 mensajes/lote</option>
                                                <option value="500">500 mensajes/lote</option>
                                            </select>
                                        </div>
                                        <div class="col-md-3">
                                            <label for="delayBetweenMessages" class="form-label">
                                                <i class="fas fa-stopwatch me-1"></i>Delay entre Mensajes
                                            </label>
                                            <select class="form-select" id="delayBetweenMessages">
                                                <option value="1">1 segundo</option>
                                                <option value="2" selected>2 segundos (Recomendado)</option>
                                                <option value="3">3 segundos</option>
                                                <option value="5">5 segundos</option>
                                            </select>
                                        </div>
                                        <div class="col-md-3">
                                            <label for="delayBetweenBatches" class="form-label">
                                                <i class="fas fa-pause-circle me-1"></i>Delay entre Lotes
                                            </label>
                                            <select class="form-select" id="delayBetweenBatches">
                                                <option value="5">5 segundos</option>
                                                <option value="10" selected>10 segundos (Recomendado)</option>
                                                <option value="30">30 segundos</option>
                                                <option value="60">1 minuto</option>
                                            </select>
                                        </div>
                                        <div class="col-md-3 d-flex align-items-end">
                                            <div class="form-check">
                                                <input class="form-check-input" type="checkbox" id="autoRetry" checked>
                                                <label class="form-check-label" for="autoRetry">
                                                    <i class="fas fa-redo me-1"></i>Auto-reintentar fallos
                                                </label>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <div class="mt-4">
                                        <div class="row">
                                            <div class="col-md-8">
                                                <div class="alert alert-info mb-0">
                                                    <i class="fas fa-clock me-2"></i>
                                                    <strong>Tiempo estimado:</strong> <span id="estimatedTime">Calculando...</span>
                                                </div>
                                            </div>
                                            <div class="col-md-4 text-md-end">
                                                <button type="button" class="btn btn-success btn-lg w-100" id="sendBulkBtn" disabled>
                                                    <i class="fas fa-rocket me-2"></i>Iniciar Envío Masivo
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <!-- Controles de proceso -->
                                    <div class="mt-3 text-center" id="processControls" style="display: none;">
                                        <button type="button" class="btn btn-warning me-2" id="pauseBtn">
                                            <i class="fas fa-pause me-2"></i>Pausar
                                        </button>
                                        <button type="button" class="btn btn-info me-2" id="resumeBtn" style="display: none;">
                                            <i class="fas fa-play me-2"></i>Reanudar
                                        </button>
                                        <button type="button" class="btn btn-danger" id="stopBtn">
                                            <i class="fas fa-stop me-2"></i>Detener
                                        </button>
                                    </div>
                                </div>

                                <!-- Progreso avanzado -->
                                <div id="advancedProgress" style="display: none;" class="mt-4">
                                    <div class="card border-0 shadow">
                                        <div class="card-header bg-light d-flex justify-content-between align-items-center">
                                            <h5 class="mb-0"><i class="fas fa-chart-line me-2"></i>Progreso del Envío</h5>
                                            <button class="btn btn-sm btn-outline-primary" onclick="showRealTimeStats()">
                                                <i class="fas fa-external-link-alt me-1"></i>Stats en Vivo
                                            </button>
                                        </div>
                                        <div class="card-body">
                                            <div class="progress-advanced mb-3">
                                                <div class="progress-bar-advanced" style="width: 0%">0%</div>
                                            </div>
                                            
                                            <div class="row mb-3">
                                                <div class="col-md-4">
                                                    <div class="text-center">
                                                        <h6>Progreso General</h6>
                                                        <div class="countdown-timer" id="overallProgress">0 / 0</div>
                                                    </div>
                                                </div>
                                                <div class="col-md-4">
                                                    <div class="text-center">
                                                        <h6>Tiempo Transcurrido</h6>
                                                        <div class="countdown-timer" id="elapsedTime">00:00:00</div>
                                                    </div>
                                                </div>
                                                <div class="col-md-4">
                                                    <div class="text-center">
                                                        <h6>Tiempo Estimado</h6>
                                                        <div class="countdown-timer" id="estimatedTimeRemaining">--:--:--</div>
                                                    </div>
                                                </div>
                                            </div>
                                            
                                            <div id="batchProgress" class="mb-3">
                                                <small class="text-muted">Preparando lotes...</small>
                                            </div>
                                            
                                            <div id="currentBatchInfo" class="alert alert-info" style="display: none;">
                                                <strong>Lote Actual:</strong> <span id="currentBatchNumber">1</span> de <span id="totalBatchNumber">1</span>
                                                <span class="ms-3"><strong>Progreso del Lote:</strong> <span id="batchProgressText">0/0</span></span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <!-- Resultados detallados -->
                                <div id="detailedResultsContainer" style="display: none;" class="mt-4">
                                    <div class="card border-0 shadow">
                                        <div class="card-header bg-light d-flex justify-content-between align-items-center">
                                            <h5 class="mb-0"><i class="fas fa-chart-bar me-2"></i>Resultados del Envío</h5>
                                            <div>
                                                <button class="btn btn-sm btn-success" onclick="downloadSuccessfulContacts()">
                                                    <i class="fas fa-download me-1"></i>Exitosos CSV
                                                </button>
                                                <button class="btn btn-sm btn-danger ms-1" onclick="downloadFailedContacts()">
                                                    <i class="fas fa-download me-1"></i>Fallidos CSV
                                                </button>
                                            </div>
                                        </div>
                                        <div class="card-body">
                                            <!-- Estadísticas finales -->
                                            <div class="row mb-4">
                                                <div class="col-md-3">
                                                    <div class="card text-center bg-success text-white border-0">
                                                        <div class="card-body py-3">
                                                            <i class="fas fa-check-circle fa-2x mb-2"></i>
                                                            <div><strong>Enviados</strong></div>
                                                            <div class="h4" id="finalTotalSent">0</div>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div class="col-md-3">
                                                    <div class="card text-center bg-danger text-white border-0">
                                                        <div class="card-body py-3">
                                                            <i class="fas fa-times-circle fa-2x mb-2"></i>
                                                            <div><strong>Fallidos</strong></div>
                                                            <div class="h4" id="finalTotalFailed">0</div>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div class="col-md-3">
                                                    <div class="card text-center bg-info text-white border-0">
                                                        <div class="card-body py-3">
                                                            <i class="fas fa-percentage fa-2x mb-2"></i>
                                                            <div><strong>Tasa de Éxito</strong></div>
                                                            <div class="h4" id="successRate">0%</div>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div class="col-md-3">
                                                    <div class="card text-center bg-warning text-white border-0">
                                                        <div class="card-body py-3">
                                                            <i class="fas fa-clock fa-2x mb-2"></i>
                                                            <div><strong>Duración</strong></div>
                                                            <div class="h4" id="totalDuration">--:--</div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                            
                                            <!-- Filtros de resultados -->
                                            <div class="mb-3">
                                                <label class="form-label"><i class="fas fa-filter me-1"></i>Filtrar resultados:</label>
                                                <div class="btn-group" role="group">
                                                    <input type="radio" class="btn-check" name="resultFilter" id="filterAll" checked>
                                                    <label class="btn btn-outline-primary" for="filterAll">
                                                        <i class="fas fa-list me-1"></i>Todos
                                                    </label>
                                                    
                                                    <input type="radio" class="btn-check" name="resultFilter" id="filterSuccess">
                                                    <label class="btn btn-outline-success" for="filterSuccess">
                                                        <i class="fas fa-check me-1"></i>Exitosos
                                                    </label>
                                                    
                                                    <input type="radio" class="btn-check" name="resultFilter" id="filterFailed">
                                                    <label class="btn btn-outline-danger" for="filterFailed">
                                                        <i class="fas fa-times me-1"></i>Fallidos
                                                    </label>
                                                </div>
                                            </div>
                                            
                                            <!-- Lista de resultados -->
                                            <div id="detailedResults" style="max-height: 500px; overflow-y: auto;"></div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- PESTAÑA: Estadísticas -->
                            <div class="tab-pane fade" id="stats" role="tabpanel">
                                <div class="row">
                                    <div class="col-12">
                                        <div class="card border-0 shadow">
                                            <div class="card-header bg-light">
                                                <h5><i class="fas fa-chart-area me-2"></i>Estadísticas de Rendimiento del Sistema</h5>
                                            </div>
                                            <div class="card-body">
                                                <div id="performanceStats">
                                                    <div class="text-center py-5">
                                                        <i class="fas fa-chart-line fa-4x text-muted mb-3"></i>
                                                        <h5 class="text-muted">Las estadísticas aparecerán aquí después de realizar envíos masivos</h5>
                                                        <p class="text-muted">El sistema registrará automáticamente métricas de rendimiento, velocidad de envío y tasas de éxito.</p>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- JavaScript Libraries -->
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/js/bootstrap.bundle.min.js"></script>
    <script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11.7.3/dist/sweetalert2.all.min.js"></script>
    
    <!-- Custom JavaScript -->
    <script src="{{ asset('js/whatsapp-system.js') }}"></script>
</body>
</html>