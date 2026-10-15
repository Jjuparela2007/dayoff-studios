-- ═══════════════════════════════════════════════════════════
--  DayOff Studio — esquema de base de datos (MySQL 8 / MariaDB 10.5+)
-- ═══════════════════════════════════════════════════════════

SET NAMES utf8mb4;

-- Administradores del panel. La contraseña se guarda SOLO como hash bcrypt.
CREATE TABLE IF NOT EXISTS admins (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(60)  NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login    TIMESTAMP NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Textos editables del sitio (eslogan, hero, sobre nosotros, contacto…)
CREATE TABLE IF NOT EXISTS settings (
  setting_key   VARCHAR(80) PRIMARY KEY,
  setting_value TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Categorías: Largometrajes, Cortometrajes, Series, Comerciales, Documentales…
CREATE TABLE IF NOT EXISTS categories (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(120) NOT NULL,
  slug        VARCHAR(140) NOT NULL UNIQUE,
  description TEXT,
  cover_url   VARCHAR(500),
  sort_order  INT DEFAULT 0,
  is_gallery  TINYINT(1) DEFAULT 0   -- 1 = categoría de solo fotos (ej. Photography): al abrirla se ve una galería, no proyectos
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Proyectos / obras
CREATE TABLE IF NOT EXISTS projects (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  category_id  INT UNSIGNED,
  title        VARCHAR(200) NOT NULL,
  slug         VARCHAR(220) NOT NULL UNIQUE,
  tagline      VARCHAR(300),
  year         SMALLINT,
  duration     VARCHAR(40),
  genre        VARCHAR(120),
  synopsis     TEXT,
  director     VARCHAR(200),
  poster_url   VARCHAR(500),
  backdrop_url VARCHAR(500),
  title_logo_url VARCHAR(500),
  trailer_url  VARCHAR(500),   -- YouTube, Vimeo o archivo .mp4
  featured     TINYINT(1) DEFAULT 0,
  published    TINYINT(1) DEFAULT 1,
  sort_order   INT DEFAULT 0,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_project_category FOREIGN KEY (category_id)
    REFERENCES categories(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Personas: actores, artistas, equipo técnico (con biografía y foto)
CREATE TABLE IF NOT EXISTS people (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(200) NOT NULL,
  kind       ENUM('actor','artista','equipo') DEFAULT 'actor',
  bio        TEXT,
  photo_url  VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Créditos de cada proyecto. Puede enlazar a una persona (para mostrar su bio)
-- o solo llevar el nombre en texto libre.
CREATE TABLE IF NOT EXISTS credits (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id INT UNSIGNED NOT NULL,
  person_id  INT UNSIGNED NULL,
  name       VARCHAR(200),
  role       VARCHAR(200) NOT NULL,             -- "Dirección de fotografía", "Protagonista"…
  department ENUM('reparto','artistas','equipo') DEFAULT 'equipo',
  sort_order INT DEFAULT 0,
  CONSTRAINT fk_credit_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_credit_person  FOREIGN KEY (person_id)  REFERENCES people(id)   ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Galería de cada proyecto: imágenes y videos
CREATE TABLE IF NOT EXISTS media (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id INT UNSIGNED NOT NULL,
  type       ENUM('image','video') DEFAULT 'image',
  url        VARCHAR(500) NOT NULL,
  caption    VARCHAR(300),
  sort_order INT DEFAULT 0,
  CONSTRAINT fk_media_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Biblioteca de archivos subidos (para reutilizarlos y borrarlos del disco)
CREATE TABLE IF NOT EXISTS uploads (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  filename      VARCHAR(255) NOT NULL,
  original_name VARCHAR(255),
  mime          VARCHAR(100),
  size_bytes    BIGINT,
  url           VARCHAR(500) NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Slugs anteriores de cada proyecto: si cambias el título/slug, los enlaces viejos redirigen al nuevo
CREATE TABLE IF NOT EXISTS project_slugs (
  slug       VARCHAR(200) NOT NULL PRIMARY KEY,
  project_id INT UNSIGNED NOT NULL,
  CONSTRAINT fk_slug_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- News: prensa, premios, festivales y videos donde aparece la marca (sección "News" del sitio)
CREATE TABLE IF NOT EXISTS news (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  kind         ENUM('press','award','festival','video') NOT NULL DEFAULT 'press',
  title        VARCHAR(300) NOT NULL,
  outlet       VARCHAR(200),
  excerpt      TEXT,
  url          VARCHAR(500),
  image_url    VARCHAR(500),
  video_url    VARCHAR(500),
  project_id   INT UNSIGNED NULL,
  published_at DATE,
  featured     TINYINT(1) DEFAULT 0,
  published    TINYINT(1) DEFAULT 1,
  sort_order   INT DEFAULT 0,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_news_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Galería del estudio: videos de rodaje y detrás de cámaras (sección "On set" del sitio).
-- url = archivo .mp4/.webm subido o link de YouTube/Vimeo; poster_url = portada opcional
CREATE TABLE IF NOT EXISTS studio_photos (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  url        VARCHAR(500) NOT NULL,
  poster_url VARCHAR(500),
  caption    VARCHAR(300),
  published  TINYINT(1) DEFAULT 1,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Fotos de las categorías tipo galería (Photography…)
CREATE TABLE IF NOT EXISTS category_photos (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  category_id INT UNSIGNED NOT NULL,
  url         VARCHAR(500) NOT NULL,
  caption     VARCHAR(300),
  section     VARCHAR(120),
  sort_order  INT DEFAULT 0,
  CONSTRAINT fk_catphoto_cat FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;