# ARCHITECTURE.md — Big Gym Tracker

**Aplicație Mobilă de Workout Tracking (Stil Hevy / Strong)**  
**Tech Stack:** React Native cu Expo (Expo Router), Expo SQLite + Drizzle ORM, Zustand, TypeScript Strict.  
**Versiune Arhitectură:** 2.0 (Toate Fluxurile de Sistem Cap-Coadă)

---

## 1. System Overview & Offline-First Strategy

### 1.1. Context & Obiectiv de Produs
„Big Gym Tracker” este o aplicație mobilă de nivel competițional pentru înregistrarea antrenamentelor de forță, axată pe viteză maximă de execuție, zero dependență de rețea și durabilitate absolută a datelor. Modelul de utilizare este inspirat din standardul stabilit de Hevy și Strong: interfață compactă, orientată pe tabele de seturi, tastatură numerică optimizată, asistență automată de cronometru și analize de volum / PR în timp real.

### 1.2. De ce Offline-First este Obligatoriu în Sălile de Forță
1. **Subsoluri și Hale Industriale Ecranate:** Sălile de fitness sunt plasate frecvent în demisoluri sau clădiri cu pereți groși de beton armat unde semnalul 4G/5G scade la zero.
2. **Wi-Fi Captiv / Instabil:** Rețelele Wi-Fi publice impun deconectări frecvente și pagini de login. O aplicație dependentă de cloud ar bloca utilizatorul în mijlocul unei serii de genuflexiuni.
3. **Toleranță Zero la Latență (<16ms):** Între două serii la efort maximal, sportivul are la dispoziție 2-3 secunde pentru a bifa setul. Orice spinner de încărcare distruge fluxul antrenamentului.
4. **Agresivitatea Sistemului de Operare (OS Process Kill):** Utilizatorul schimbă frecvent între aplicație, camera foto și aplicații audio (Spotify, Apple Music). Dacă Android sau iOS oprește procesul în fundal din lipsă de memorie, starea trebuie restaurată instantaneu și fără pierderi la repornire.

### 1.3. Decizia Tehnologică: Expo SQLite + Drizzle ORM vs. WatermelonDB

| Criteriu de Evaluare | WatermelonDB | Expo SQLite + Drizzle ORM (Soluția Aleasă) | Justificare Tehnică |
| :--- | :--- | :--- | :--- |
| **Arhitectură Nativă & Engine** | SQLite accesat prin punți native legacy sau configurări JSI complexe | `expo-sqlite` (JSI C++ bindings native integrate direct în runtime-ul Expo SDK 51+) | Zero cod nativ manual; integrare nativă directă cu Expo EAS Build. |
| **Modelare & Tipizare TypeScript** | Modele bazate pe clase, `@decorators` și Babel plugins specifice | Schemă TypeScript pur declarativă, inferență statică 100% type-safe | Erorile de structură sunt interceptate la compilare (`tsc`), nu în runtime. |
| **Migrații de Bază de Date** | Migrații manuale în clase JavaScript | Generare automată de migrații SQL versionate prin `drizzle-kit` | Trasabilitate clară și migrare sigură a schemelor pe dispozitivul clientului. |
| **Interogări Agregate de Volum** | Abstractizare rigidă a query-urilor; dificil de rulat calcule agregate complexe | Suport hibrid: ORM tipizat + Raw SQL optimizat cu funcții agregate și window functions | Calculează rapoarte de zeci de mii de seturi în sub 3ms direct în motorul SQLite. |
| **Overhead & Compatibilitate** | Pachet masiv, dependent de RxJS și arhitectură reactive observabilă | Modular, ultra-ușor, fără dependențe ascunse, compatibil nativ cu React 19 | Amprentă minimă în memoria RAM a dispozitivului mobil. |

---

## 2. Data Model & Database Schema

Baza de date locală SQLite este complet normalizată (3NF), garantând integritate relațională prin chei externe și constrângeri de domeniu.

### 2.1. Scriptul DDL SQL Complet (SQLite 3.35+)

```sql
PRAGMA foreign_keys = ON;

-- 1. muscle_groups: Catalog grupe musculare
CREATE TABLE IF NOT EXISTS muscle_groups (
    id TEXT PRIMARY KEY NOT NULL, -- 'chest', 'back', 'quads', 'hamstrings', 'shoulders', 'biceps', 'triceps', 'calves', 'abs'
    name TEXT NOT NULL,           -- 'Piept', 'Spate', 'Cvadricepși' etc.
    body_region TEXT NOT NULL CHECK(body_region IN ('upper', 'lower', 'core'))
);

-- 2. exercises: Catalog complet de exerciții
CREATE TABLE IF NOT EXISTS exercises (
    id TEXT PRIMARY KEY NOT NULL, -- UUIDv4
    name TEXT NOT NULL,
    primary_muscle_id TEXT NOT NULL,
    secondary_muscles_json TEXT DEFAULT '[]', -- JSON array: ["triceps", "front_delts"]
    equipment_type TEXT NOT NULL CHECK(
        equipment_type IN ('barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'smith_machine')
    ),
    is_custom INTEGER NOT NULL DEFAULT 0, -- 0 = preinstalat, 1 = creat de utilizator
    instructions TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (primary_muscle_id) REFERENCES muscle_groups(id) ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_exercises_primary_muscle ON exercises(primary_muscle_id);
CREATE INDEX IF NOT EXISTS idx_exercises_equipment ON exercises(equipment_type);

-- 3. routines: Șabloane de antrenament (Split-uri)
CREATE TABLE IF NOT EXISTS routines (
    id TEXT PRIMARY KEY NOT NULL, -- UUIDv4
    title TEXT NOT NULL,          -- 'Push Day A', 'Pull Day B', 'Legs Hypertrophy'
    split_category TEXT,          -- 'Push', 'Pull', 'Legs', 'Upper', 'Lower', 'Full Body'
    notes TEXT,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- 4. routine_exercises: Relație many-to-many ordonată între Rutine și Exerciții
CREATE TABLE IF NOT EXISTS routine_exercises (
    id TEXT PRIMARY KEY NOT NULL, -- UUIDv4
    routine_id TEXT NOT NULL,
    exercise_id TEXT NOT NULL,
    order_index INTEGER NOT NULL, -- 1, 2, 3... ordinea în sesiune
    target_sets INTEGER NOT NULL DEFAULT 3,
    target_reps_min INTEGER NOT NULL DEFAULT 8,
    target_reps_max INTEGER NOT NULL DEFAULT 12,
    default_rest_seconds INTEGER NOT NULL DEFAULT 90,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (routine_id) REFERENCES routines(id) ON DELETE CASCADE,
    FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE RESTRICT,
    UNIQUE (routine_id, order_index)
);

CREATE INDEX IF NOT EXISTS idx_routine_exercises_routine ON routine_exercises(routine_id);

-- 5. workout_sessions: Instanțe reale de antrenament
CREATE TABLE IF NOT EXISTS workout_sessions (
    id TEXT PRIMARY KEY NOT NULL, -- UUIDv4
    routine_id TEXT,              -- Nullable (utilizatorul poate începe și freestyle / ad-hoc)
    title TEXT NOT NULL,          -- 'Push Day A', 'Quick Workout'
    start_time INTEGER NOT NULL,  -- Timestamp Unix (secunde)
    end_time INTEGER,             -- Timestamp Unix (secunde), NULL cât timp este activ
    duration_seconds INTEGER DEFAULT 0,
    notes TEXT,
    total_volume_kg REAL NOT NULL DEFAULT 0.0,
    status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress', 'completed', 'discarded')),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (routine_id) REFERENCES routines(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_workout_sessions_status ON workout_sessions(status);
CREATE INDEX IF NOT EXISTS idx_workout_sessions_start_time ON workout_sessions(start_time DESC);

-- 6. workout_sets: Seturi efective executate
CREATE TABLE IF NOT EXISTS workout_sets (
    id TEXT PRIMARY KEY NOT NULL, -- UUIDv4
    session_id TEXT NOT NULL,
    exercise_id TEXT NOT NULL,
    order_index INTEGER NOT NULL, -- Index exercițiu în sesiune
    set_number INTEGER NOT NULL,  -- Set 1, 2, 3 etc.
    set_type TEXT NOT NULL DEFAULT 'normal' CHECK(set_type IN ('warmup', 'normal', 'drop', 'failure')),
    weight_kg REAL NOT NULL DEFAULT 0.0,
    reps INTEGER NOT NULL DEFAULT 0,
    rpe REAL CHECK(rpe IS NULL OR (rpe >= 5.0 AND rpe <= 10.0)),
    is_completed INTEGER NOT NULL DEFAULT 0, -- Boolean (0/1)
    completed_at INTEGER,         -- Timestamp Unix când s-a bifat seria
    rest_duration_seconds INTEGER DEFAULT 90,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (session_id) REFERENCES workout_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_workout_sets_session ON workout_sets(session_id);
CREATE INDEX IF NOT EXISTS idx_workout_sets_exercise ON workout_sets(exercise_id);
CREATE INDEX IF NOT EXISTS idx_workout_sets_completed ON workout_sets(exercise_id, is_completed, completed_at);

-- 7. personal_records: Istoric de recorduri personale
CREATE TABLE IF NOT EXISTS personal_records (
    id TEXT PRIMARY KEY NOT NULL, -- UUIDv4
    exercise_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    set_id TEXT NOT NULL,
    record_type TEXT NOT NULL CHECK(record_type IN ('max_weight', 'estimated_1rm', 'max_volume')),
    value REAL NOT NULL,
    achieved_at INTEGER NOT NULL,
    FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES workout_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (set_id) REFERENCES workout_sets(id) ON DELETE CASCADE,
    UNIQUE (exercise_id, record_type, value, achieved_at)
);

CREATE INDEX IF NOT EXISTS idx_personal_records_lookup ON personal_records(exercise_id, record_type);

-- 8. user_settings: Preferințe utilizator și timer global
CREATE TABLE IF NOT EXISTS user_settings (
    key TEXT PRIMARY KEY NOT NULL,
    value_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

---

## 3. State Management Architecture: Zustand vs. SQLite

Aplicația folosește o delimitare strictă între **starea efemeră / de mare frecvență** (Zustand) și **sursa de adevăr durabilă** (SQLite + Drizzle).

```
┌────────────────────────────────────────────────────────┐
│                   UI LAYER (React Native)              │
│       ActiveWorkoutScreen, SetRow, RestTimerBanner     │
└──────────────┬──────────────────────────▲──────────────┘
               │ Acțiuni Utilizator       │ Selectori Reactivi
               ▼                          │
┌─────────────────────────────────────────┴──────────────┐
│                  ZUSTAND CLIENT STORES                 │
│  • useActiveWorkoutStore (Date sesiune în desfășurare) │
│  • useRestTimerStore (Timer sincronizat pe timestamp)  │
│  • useWorkoutUIStore (Modale, Calculator de Discuri)   │
└──────────────┬──────────────────────────▲──────────────┘
               │ Seturi Confirmate /      │ Hidratare Sesiune /
               │ Autosave Debounced       │ Previous Performance
               ▼                          │
┌─────────────────────────────────────────┴──────────────┐
│          DRIZZLE ORM & EXPO SQLITE ENGINE              │
│  • Fila de date nativă: gym_tracker.db                 │
│  • Integritate Tranzacțională & Foreign Keys           │
└────────────────────────────────────────────────────────┘
```

### 3.1. Repartizarea Datelor

| Domeniu | Tehnologie Primară | Motivare |
| :--- | :--- | :--- |
| **Input-uri la tastare (greutate, reps)** | **Zustand** | Modificarea textului per tastă nu trebuie să genereze operațiuni I/O de scriere pe disc. |
| **Rest Timer (secunde rămase)** | **Zustand** | Scăderea secundă cu secundă este o operațiune pur în memorie; persistența ar degrada bateria. |
| **Seturi Bifate (`is_completed = 1`)** | **SQLite (Drizzle)** | Scriere imediată garantată; protejează utilizatorul de pierderea progresului în caz de crash. |
| **Istoricul Antrenamentelor & PR-uri** | **SQLite (Drizzle)** | Date durabile, indexate pentru interogări analitice rapide. |
| **Catalogul de Exerciții & Rutine** | **SQLite (Drizzle)** | Date relaționale, grupate pe categorii, cu suport de căutare full-text. |

---

## 4. Folder & Module Structure (Expo Router)

```
big-gym-tracker/
├── app.json
├── package.json
├── tsconfig.json
├── drizzle.config.ts
│
├── src/
│   ├── app/                                # Expo Router (File-Based Navigation)
│   │   ├── _layout.tsx                     # Root: DatabaseProvider, Theme, KeepAwake
│   │   ├── (tabs)/
│   │   │   ├── _layout.tsx                 # Tab Bar Navigation
│   │   │   ├── index.tsx                   # Dashboard: Quick Start & Rezumat Săptămânal
│   │   │   ├── routines/
│   │   │   │   ├── index.tsx               # Lista Rutinelor (Push/Pull/Legs)
│   │   │   │   ├── [id].tsx                # Vizualizare / Editare Structură Rutină
│   │   │   │   └── create.tsx              # Builder Rutină Nouă
│   │   │   ├── history/
│   │   │   │   ├── index.tsx               # Calendar & Listă Sesiuni Finalizate
│   │   │   │   ├── [sessionId].tsx         # Detalii Sesiune Istorică
│   │   │   │   └── edit-[sessionId].tsx    # Editare Retrospectivă Sesiune
│   │   │   └── analytics/
│   │   │       ├── index.tsx               # Volum Total & Distribuție Musculară
│   │   │       └── exercise-[id].tsx       # Grafic 1RM & Progres pe Exercițiu
│   │   ├── workout/
│   │   │   ├── active.tsx                  # Ecranul Sesiunii Active (Core Loop)
│   │   │   └── summary.tsx                 # Ecranul de Finalizare & Recapitulare PR
│   │   └── modal/
│   │       ├── exercise-picker.tsx         # Modal Selecție Exercițiu (Filtre / Căutare)
│   │       ├── plate-calculator.tsx        # Calculator Discuri Bară Olimpică
│   │       ├── warmup-calculator.tsx       # Calculator Serii Încălzire
│   │       └── rpe-guide.tsx               # Ghid de Evaluare RPE (Scara Borg)
│   │
│   ├── db/
│   │   ├── client.ts                       # Singleton Expo SQLite + Drizzle instance
│   │   ├── schema.ts                       # Schema Drizzle ORM completă
│   │   ├── migrations/                     # Fișiere de migrație generate
│   │   └── seeds/
│   │       ├── muscleGroups.ts             # Seed: 9 grupe musculare principale
│   │       └── defaultExercises.ts         # Seed: 200+ exerciții standard
│   │
│   ├── store/
│   │   ├── useActiveWorkoutStore.ts        # Zustand: sesiune în curs, exerciții, seturi
│   │   ├── useRestTimerStore.ts            # Zustand: timer pe timestamp, pauză, haptics
│   │   └── useWorkoutUIStore.ts            # Zustand: vizibilitate sheets, modale
│   │
│   ├── components/
│   │   ├── workout/
│   │   │   ├── ActiveWorkoutHeader.tsx     # Titlu sesiune, timp scurs, buton Finish
│   │   │   ├── ExerciseCard.tsx            # Card exercițiu cu tabelul de seturi
│   │   │   ├── SetRow.tsx                  # Rând individual: Kg, Reps, RPE, Checkmark
│   │   │   ├── RestTimerBanner.tsx         # Banner plutitor cu cronometru activ
│   │   │   └── PreviousPerformanceHint.tsx # Placeholder luminos cu datele anterioare
│   │   ├── common/
│   │   │   ├── NumericKeyboard.tsx         # Tastatură numerică inline rapidă
│   │   │   └── ConfettiOverlay.tsx         # Animație celebrare finalizare sesiune
│   │   └── analytics/
│   │       ├── MuscleVolumeBarChart.tsx
│   │       └── OneRMProgressLineChart.tsx
│   │
│   ├── services/
│   │   ├── workoutSessionService.ts        # Pornire, salvare, abandonare sesiune
│   │   ├── prDetectorService.ts            # Detecție 1RM Brzycki & salvare PR-uri
│   │   ├── volumeAggregatorService.ts      # Query-uri agregate SQL de mare viteză
│   │   ├── soundAndHapticsService.ts       # Sunete de clopoțel & vibrații haptice
│   │   └── backupService.ts                # Export / Import CSV (format Hevy/Strong)
│   │
│   ├── hooks/
│   │   ├── useDatabaseBootstrap.ts         # Verificare migrații și seed la pornire
│   │   ├── useAppStateRestTimer.ts         # Sincronizare timer la revenirea din background
│   │   └── useKeepScreenAwake.ts           # Menținere ecran aprins pe durata sesiunii
│   │
│   └── types/
│       ├── workout.ts
│       └── exercise.ts
```

---

## 5. Ghidul Complet al Tuturor Fluxurilor de Sistem (End-to-End Workflows)

Iată maparea exhaustivă a fiecărui flux de lucru pe care îl va parcurge aplicația pe parcursul ciclului său de viață:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        MAPA TUTUROR FLUXURILOR                         │
├────────────────────────────────┬───────────────────────────────────────┤
│ 1. Ciclu de Viață & Lansare    │ 1.1 Cold Start & DB Migrations / Seed │
│                                │ 1.2 Crash & OS Kill Recovery          │
│                                │ 1.3 Foreground/Background Sincronizare│
├────────────────────────────────┼───────────────────────────────────────┤
│ 2. Rutine & Șabloane           │ 2.1 Creare Rutină Nouă (Builder)      │
│                                │ 2.2 Reordonare & Editare Rutină       │
│                                │ 2.3 Duplicare Rutină                  │
│                                │ 2.4 Ștergere Rutină                   │
│                                │ 2.5 Salvare Antrenament ca Rutină     │
├────────────────────────────────┼───────────────────────────────────────┤
│ 3. Sesiunea Activă (Core Loop) │ 3.1 Start Workout (Rutină vs Quick)   │
│                                │ 3.2 Modificare Exerciții din Mers     │
│                                │     (Add, Swap, Reorder, Remove)      │
│                                │ 3.3 Logare Set & Validare Core Loop   │
│                                │ 3.4 Unelte: Calculator Discuri & Cald │
│                                │ 3.5 Finalizare Antrenament & PRs      │
│                                │ 3.6 Abandonare Antrenament            │
├────────────────────────────────┼───────────────────────────────────────┤
│ 4. Rest Timer                  │ 4.1 Auto-Start la Bifare Set          │
│                                │ 4.2 Ajustare (+30s / -15s / Skip)     │
│                                │ 4.3 Notificare & Audio pe Ecran Stins │
├────────────────────────────────┼───────────────────────────────────────┤
│ 5. Catalog Exerciții           │ 5.1 Căutare & Filtrare Multidimensional│
│                                │ 5.2 Creare Exercițiu Custom           │
│                                │ 5.3 Vizualizare Fișă Exercițiu        │
├────────────────────────────────┼───────────────────────────────────────┤
│ 6. Istoric & Corecții          │ 6.1 Răsfoire Calendar & Listă Istoric │
│                                │ 6.2 Editare Retrospectivă Sesiune     │
│                                │ 6.3 Ștergere Sesiune Trecută          │
├────────────────────────────────┼───────────────────────────────────────┤
│ 7. Analitice & Rapoarte        │ 7.1 Agregare Volum fără Lag de UI     │
│                                │ 7.2 Evoluție 1RM pe Exercițiu         │
├────────────────────────────────┼───────────────────────────────────────┤
│ 8. Portabilitate & Backup      │ 8.1 Export CSV (Format Strong/Hevy)   │
│                                │ 8.2 Import CSV                        │
│                                │ 8.3 Backup Local Fișier SQLite        │
└────────────────────────────────┴───────────────────────────────────────┘
```

---

### CATEGORIA 1: Ciclu de Viață, Lansare & Reziliență

#### 1.1. Cold Start, Verificare Bază de Date & Populare Inițială (Seeding)
* **Declanșator:** Utilizatorul deschide aplicația (prima rulare sau după un update de versiune).
* **Flux de Execuție:**
  1. `src/app/_layout.tsx` montează hook-ul `useDatabaseBootstrap()`.
  2. Deschidere fișier SQLite local via `openDatabaseAsync('gym_tracker.db')`.
  3. Verificare `PRAGMA user_version`. Dacă versiunea este inferioară migrațiilor Drizzle curente, se rulează tranzacția DDL de migrație.
  4. Verificare dacă tabela `exercises` este populată (`SELECT COUNT(*) FROM exercises`).
  5. Dacă rezultatul este `0`, se inserează în tranzacție unică cele 9 grupe musculare din `muscleGroups.ts` și cele peste 200 de exerciții standard din `defaultExercises.ts`.
  6. Se semnalează `isReady = true` și se ascunde Splash Screen-ul nativ (`SplashScreen.hideAsync()`).

#### 1.2. Detectare Crash & Restaurare Sesiune Întreruptă (Crash Recovery)
* **Declanșator:** Aplicația se deschide după ce sistemul de operare a oprit forțat procesul (OS kill din lipsă de memorie) sau bateria s-a descărcat în timpul antrenamentului.
* **Flux de Execuție:**
  1. La finalizarea bootstrap-ului DB, se execută interogarea:
     ```sql
     SELECT id, title, start_time FROM workout_sessions WHERE status = 'in_progress' LIMIT 1;
     ```
  2. Dacă se găsește o sesiune activă:
     - Aplicația afișează un banner modal: *„Ai un antrenament în curs început la [Ora]. Vrei să îl continui?”*.
     - Dacă utilizatorul apasă **„Continuă”**: Se încarcă toate seturile existente din `workout_sets` pentru `session_id` în `useActiveWorkoutStore`, iar routerul redirecționează automat la `/workout/active`.
     - Dacă utilizatorul apasă **„Abandonează”**: Sesiunea este ștearsă sau marcată `status = 'discarded'`, curățând starea.

#### 1.3. Tranziția Foreground <-> Background (Sincronizare Timer & KeepAwake)
* **Declanșator:** Utilizatorul comută la Spotify, blochează ecranul telefonului sau revine în aplicație.
* **Flux de Execuție:**
  1. Cât timp ecranul `/workout/active` este montat, se apelează `activateKeepAwakeAsync()` pentru a preveni stingerea automată a ecranului în timp ce utilizatorul se uită la seturi.
  2. Când evenimentul `AppState` trece în `background`:
     - Timer-ul din `useRestTimerStore` oprește bucla locală `setInterval`.
     - Ținta de timp `targetEndTime` (în milisecunde absolute) rămâne neatinsă.
     - Se programează o notificare locală precisă prin `expo-notifications` programată la `targetEndTime`.
  3. Când `AppState` trece în `active`:
     - Se anulează notificările locale pendinte (dacă utilizatorul a revenit înainte de expirare).
     - Se execută `useRestTimerStore.getState().syncWithCurrentTime()`.
     - Se recalculează timpul rămas: `remaining = targetEndTime - Date.now()`.
     - Dacă `remaining <= 0`, se oprește timer-ul și se emite un semnal haptic dacă utilizatorul a ratat notificarea.

---

### CATEGORIA 2: Managementul Rutinelor & Șabloanelor (Routines)

#### 2.1. Crearea unei Rutine Noi (Builder)
* **Declanșator:** Utilizatorul apasă „New Routine” în tab-ul `/routines`.
* **Flux de Execuție:**
  1. Se deschide ecranul `/routines/create`.
  2. Utilizatorul introduce titlul (ex: „Push Day Focus Piept”) și selectează categoria de split (`Push`).
  3. Apăsarea pe „Add Exercise” deschide modalul `/modal/exercise-picker`.
  4. După selectarea exercițiilor, fiecare exercițiu este afișat într-o listă reordonabilă cu setări implicite (3 seturi, 8–12 repetări, 90s odihnă).
  5. La salvare („Save Routine”):
     - Se generează un UUIDv4 pentru `routine_id`.
     - Se execută o tranzacție atomică în SQLite:
       - `INSERT INTO routines (id, title, split_category, notes, order_index) ...`
       - `INSERT INTO routine_exercises (id, routine_id, exercise_id, order_index, target_sets, target_reps_min, target_reps_max, default_rest_seconds) ...`
     - Navigare înapoi la `/routines` cu toast de confirmare.

#### 2.2. Reordonarea și Editarea unei Rutine Existente
* **Declanșator:** Utilizatorul accesează `/routines/[id]` și intră în modul de editare.
* **Flux de Execuție:**
  1. Utilizatorul poate reordona exercițiile folosind gesturi de drag & drop.
  2. Poate modifica numărul de seturi țintă sau timpul de odihnă per exercițiu.
  3. La salvare, într-o tranzacție SQLite:
     - Se actualizează rândul din `routines` (`updated_at = unixepoch()`).
     - Se actualizează `order_index` pentru fiecare `routine_exercise`. Dacă s-au șters exerciții, acestea sunt eliminate prin `DELETE FROM routine_exercises WHERE id = ?`.

#### 2.3. Duplicarea unei Rutine (Duplicate Routine)
* **Declanșator:** Utilizatorul dorește să creeze „Push B” pornind de la „Push A”.
* **Flux de Execuție:**
  1. Citire rutină sursă și toate `routine_exercises` asociate.
  2. Generare UUID nou pentru rutină cu titlul `[Nume Sursă] (Copy)`.
  3. Inserare în bloc a noilor rânduri în `routine_exercises` cu noile ID-uri.

#### 2.4. Ștergerea unei Rutine (Delete Routine)
* **Declanșator:** Utilizatorul șterge o rutină din meniul de opțiuni.
* **Flux de Execuție:**
  1. Confirmare prin dialog alert.
  2. Execuție: `DELETE FROM routines WHERE id = ?`.
  3. Datorită regulilor `ON DELETE CASCADE`, toate intrările asociate din `routine_exercises` se șterg instantaneu.
  4. Sesiunile din trecut care foloseau această rutină rămân intacte, câmpul `routine_id` din `workout_sessions` devenind `NULL` prin `ON DELETE SET NULL`.

#### 2.5. Salvarea unui Antrenament Activ ca Rutină Nouă (Save Workout as Routine)
* **Declanșator:** Utilizatorul a început un antrenament freestyle la sală, i-a plăcut selecția de aparate și alege „Save as Routine”.
* **Flux de Execuție:**
  1. Din starea `useActiveWorkoutStore`, se extrage lista unică de exerciții executate în sesiune.
  2. Se populează o rutină nouă cu seturile și repetările realizate în acea zi.
  3. Se salvează în tabelele `routines` și `routine_exercises`.

---

### CATEGORIA 3: Sesiunea Activă de Antrenament (Core Gym Loop)

#### 3.1. Pornirea unui Antrenament (Start Workout)
* **Cazul 3.1.1 — Din Rutină:**
  1. Utilizatorul apasă „Start Routine” pe „Pull Day”.
  2. Se citesc toate exercițiile din `routine_exercises` ordonate după `order_index`.
  3. Pentru fiecare exercițiu, se interoghează SQLite pentru a găsi **performanța anterioară (Previous Performance)**:
     ```sql
     SELECT weight_kg, reps, set_number 
     FROM workout_sets 
     WHERE exercise_id = ? AND is_completed = 1 
       AND session_id = (
         SELECT id FROM workout_sessions 
         WHERE status = 'completed' AND id IN (SELECT session_id FROM workout_sets WHERE exercise_id = ?)
         ORDER BY start_time DESC LIMIT 1
       )
     ORDER BY set_number ASC;
     ```
  4. Se creează rândul sesiunii în `workout_sessions` (`status = 'in_progress'`).
  5. Se populează `useActiveWorkoutStore`, iar utilizatorul este navigat la `/workout/active`.
* **Cazul 3.1.2 — Quick Start / Freestyle (Fără Rutină):**
  1. Se creează o sesiune goală cu titlul implicit „Quick Workout - [Data]”.
  2. Ecranul se deschide imediat, invitând utilizatorul să apese „Add Exercise”.

#### 3.2. Modificarea Exercițiilor în Timpul Sesiunii
* **Adăugare Exercițiu:** Deschide `/modal/exercise-picker`. La selectare, exercițiul este adăugat la sfârșitul listei cu 3 seturi goale inițializate cu datele anterioare.
* **Înlocuire Exercițiu (Swap Exercise):** Dacă aparatul este ocupat la sală (ex: banca orizontală e plină), sportivul alege „Swap with Dumbbell Bench Press”. Exercițiul este înlocuit pe loc, păstrând numărul de serii configurate.
* **Reordonare Exerciții:** Drag & drop pentru a schimba ordinea aparatelor în funcție de disponibilitatea din sală.
* **Ștergere Exercițiu:** Eliminarea completă a unui exercițiu din sesiune și curățarea seturilor sale din SQLite.

#### 3.3. Logarea unui Set (Core Loop — Pas cu Pas)
Aceasta este acțiunea repetată de 20-30 de ori pe sesiune:
1. **Introducere Date:** Utilizatorul introduce `weightKg` și `reps` folosind tastatura numerică dedicată sau butoanele de incrementare rapidă (`+2.5kg`, `+1 rep`).
2. **Opțional RPE:** Poate selecta valoarea RPE (ex: 8.5) dintr-un selector rapid.
3. **Bifare (Atingere Checkmark):**
   - **Feedback Tactil Imediat:** `Haptics.impactAsync(Heavy)`.
   - **Actualizare Vizuală Instantanee (<16ms):** Rândul devine verde în UI via Zustand.
   - **Declanșare Rest Timer:** Se inițializează cronometrul pe `defaultRestSeconds`.
   - **Persistență Asincronă:** Se actualizează rândul în `workout_sets` (`is_completed = 1`, `completed_at = unixepoch()`).
   - **Detecție Personal Record (PR):**
     - Se calculează $1RM = \text{weight} \times \left(\frac{36}{37 - \text{reps}}\right)$.
     - Se compară cu recordul stocat în `personal_records` pentru acel exercițiu.
     - Dacă este depășit, se afișează un badge auriu „PR! 🏆” pe ecran.
4. **Debifare Set:** Dacă sportivul a atins butonul din greșeală, re-atingerea bifei anulează starea (`is_completed = 0`), oprește cronometrul și actualizează SQLite.

#### 3.4. Unelte Utilitare în Timpul Sesiunii
* **Plate Calculator (Calculator de Discuri):**
  - Utilizatorul atinge greutatea (ex: 102.5 kg). Se deschide modalul `/modal/plate-calculator`.
  - Sistemul scade greutatea barei olimpice (20 kg) și calculează discurile necesare pe fiecare parte:
    $$(102.5 - 20) / 2 = 41.25\text{ kg pe parte}$$
  - Rezultat vizual: 1×20kg, 1×15kg, 1×5kg, 1×1.25kg pe fiecare parte.
* **Warm-up Calculator (Calculator Serii Încălzire):**
  - Pe baza greutății de lucru țintă (ex: 100 kg), generează automat 4 serii de încălzire progresivă:
    - Seria 1: Bară goală (20 kg) × 10 reps
    - Seria 2: 50% (50 kg) × 5 reps
    - Seria 3: 70% (70 kg) × 3 reps
    - Seria 4: 85% (85 kg) × 1 rep
* **Notițe per Exercițiu:** Câmp text salvat pentru instrucțiuni specifice (ex: „Scaun reglat la treapta 4, priză largă”).

#### 3.5. Finalizarea Antrenamentului (Finish Workout)
1. Utilizatorul apasă butonul „Finish” din header.
2. **Validare Seturi:** Dacă există seturi începute dar nebifate, apare un dialog:
   *„Ai 2 seturi nefinalizate. Vrei să le bifezi ca terminate sau să le ștergi?”*
3. **Calcul Agregat:**
   - Se calculează volumul total: $\sum (\text{weight} \times \text{reps})$ pentru toate seturile cu `is_completed = 1`.
   - Se calculează durata efectivă în secunde: $\text{duration} = \text{now}() - \text{start\_time}$.
4. **Scriere Tranzacțională:**
   - Se actualizează `workout_sessions` (`status = 'completed'`, `end_time = unixepoch()`, `total_volume_kg`, `duration_seconds`).
   - Se inserează noile recorduri în `personal_records`.
5. **Tranziție & Celebrare:**
   - Navigare la `/workout/summary`.
   - Afișare confetti, rezumat volum total, număr seturi și lista de PR-uri doborâte.
   - Resetare store Zustand.

#### 3.6. Abandonarea Antrenamentului (Discard Workout)
1. Utilizatorul alege „Discard Workout” din meniul cu trei puncte.
2. Dialog de alertă distructivă: *„Ești sigur că vrei să renunți? Toate datele din această sesiune vor fi șterse.”*
3. La confirmare:
   - `DELETE FROM workout_sessions WHERE id = ?` (șterge în cascadă și toate seturile asociate).
   - Oprire Rest Timer.
   - Resetare completă `useActiveWorkoutStore` și navigare înapoi la Dashboard.

---

### CATEGORIA 4: Managementul Cronometrului de Odihnă (Rest Timer)

#### 4.1. Auto-Declanșare la Bifarea Setului
* La fiecare bifare de set, se citește timpul de odihnă alocat acelui exercițiu (implicit 90s, sau configurat personalizat, ex: 180s pentru îndreptări).
* Bannerul plutitor `RestTimerBanner` devine vizibil în partea de jos a ecranului.

#### 4.2. Control Manual în Timp Real
* Butoane rapide pe banner: `+30s` (pentru când ești încă obosit), `-15s`, `Pause` și `Skip` (trecere imediată la seria următoare).

#### 4.3. Semnalizare la Expirare (Audio & Haptics)
* Când cronometrul ajunge la 0 secunde:
  - Se declanșează un model haptic repetitiv (`NotificationFeedbackType.Success`).
  - Se redă un sunet scurt discret (clopoțel de sală via `expo-av`).
  - Bannerul își schimbă culoarea temporar în verde aprins indicând: *„Timpul a expirat! Ești gata de serie.”*

---

### CATEGORIA 5: Catalogul de Exerciții & Exerciții Personalizate

#### 5.1. Căutare & Filtrare în Catalog
* Interfață cu bară de căutare fuzzy și selector de cipuri:
  - Filtrare după grupa musculară primară (Piept, Spate, Cvadricepși, etc.).
  - Filtrare după tipul de echipament (Barbell, Dumbbell, Machine, Cable, Smith Machine, Bodyweight).
  - Comutator „Custom Exercises Only”.

#### 5.2. Crearea unui Exercițiu Personalizat (Custom Exercise)
1. Utilizatorul apasă „Create Custom Exercise” din modalul de selecție.
2. Completează: Numele exercițiului, Grupa musculară principală, Grupe musculare secundare (multi-select), Tip echipament și Instrucțiuni/Notițe opționale.
3. Se salvează în tabela `exercises` cu indicatorul `is_custom = 1`.
4. Exercițiul devine imediat disponibil pentru toate rutinele și antrenamentele viitoare.

#### 5.3. Vizualizarea Fișei unui Exercițiu
* Deschide ecranul dedicat exercițiului:
  - Graficul evoluției greutății maxime și a 1RM estimat pe ultimele 6 luni.
  - Recordurile personale curente (Greutate Maximă, Volum Maxim pe o serie).
  - Istoricul tuturor sesiunilor în care a fost executat.

---

### CATEGORIA 6: Istoricul Antrenamentelor & Editare Retrospectivă

#### 6.1. Răsfoirea Calendarului și a Listei Cronologice
* Tab-ul `/history` oferă două moduri de vizualizare:
  - **Listă Cronologică (Infinite Scroll):** Carduri compacte pentru fiecare sesiune (Titlu, Dată, Durată, Volum total, Număr PR-uri).
  - **Vizualizare Calendar:** Buline pe zilele în care sportivul s-a antrenat, facilitând monitorizarea consistenței.

#### 6.2. Editarea Retrospectivă a unei Sesiuni din Istoric
* **Scenariu:** Utilizatorul a uitat să treacă greutatea corectă la un set de ieri (a trecut 80 kg în loc de 85 kg).
* **Flux de Execuție:**
  1. Utilizatorul accesează detaliile antrenamentului și apasă „Edit Workout”.
  2. Modifică datele dorite în ecranul de corecție.
  3. La salvare:
     - Se actualizează rândurile corespunzătoare din `workout_sets`.
     - Se recalculează volumul total al sesiunii:
       ```sql
       UPDATE workout_sessions 
       SET total_volume_kg = (
           SELECT COALESCE(SUM(weight_kg * reps), 0) 
           FROM workout_sets 
           WHERE session_id = ? AND is_completed = 1
       )
       WHERE id = ?;
       ```
     - Se re-evaluează dacă modificarea afectează tabela `personal_records`.

#### 6.3. Repetarea unui Antrenament Trecut (Repeat Workout)
* Utilizatorul selectează un antrenament din istoric și apasă „Perform Again”.
* Sistemul extrage exercițiile din acea sesiune și pornește o sesiune activă nouă pre-populată.

---

### CATEGORIA 7: Rapoarte Analitice & Progres de Forță

#### 7.1. Calculul Volumului Agregat Fără Blocarea Interfeței (Zero-Lag Analytics)
* **Provocare Tehnică:** Istoricul poate acumula zeci de mii de seturi. Procesarea cu bucle JavaScript pe firul principal ar îngheța interfața (frame drops).
* **Soluție Arhitecturală:** Toate calculele sunt descărcate integral în motorul SQLite prin interogări agregate native:
  ```sql
  -- Distribuție volum pe grupe musculare în ultimele 30 de zile
  SELECT 
      mg.id AS muscle_id,
      mg.name AS muscle_name,
      COUNT(DISTINCT s.id) AS total_sets_completed,
      COALESCE(SUM(s.weight_kg * s.reps), 0) AS total_volume_kg,
      ROUND(
          100.0 * COALESCE(SUM(s.weight_kg * s.reps), 0) / 
          NULLIF(SUM(SUM(s.weight_kg * s.reps)) OVER (), 0), 1
      ) AS volume_percentage
  FROM workout_sets s
  JOIN exercises e ON s.exercise_id = e.id
  JOIN muscle_groups mg ON e.primary_muscle_id = mg.id
  JOIN workout_sessions ws ON s.session_id = ws.id
  WHERE s.is_completed = 1 
    AND ws.status = 'completed'
    AND ws.start_time >= unixepoch() - (30 * 86400)
  GROUP BY mg.id, mg.name
  ORDER BY total_volume_kg DESC;
  ```
* Interogarea rulează în under 3ms pe baza indexului compus `idx_workout_sets_completed`. Rezultatul compact de câțiva octeți este trimis direct către componentele de grafic (Skia / Reanimated).

---

### CATEGORIA 8: Portabilitate, Import / Export & Backup de Date

#### 8.1. Export Date în Format CSV (Compatibilitate Hevy / Strong)
* Permite exportul complet al istoricului într-un format CSV standard deschis:
  `Date, Workout Name, Exercise Name, Set Order, Weight, Reps, RPE, Notes`
* Fișierul generat este partajat prin dialogul nativ al sistemului de operare via `expo-sharing`.

#### 8.2. Import Istoric din Fișiere CSV Hevy / Strong
* Utilizatorul poate trece de la alte aplicații fără a-și pierde istoricul:
  1. Parsare asincronă a fișierului CSV linie cu linie.
  2. Mapare automată a numelor de exerciții cu catalogul existent. Dacă un exercițiu nu există, se creează ca exercițiu custom.
  3. Inserare în tranzacție de mare viteză cu batch statements în SQLite.

#### 8.3. Backup Local și Restaurare Bază de Date
* Copiere directă a fișierului `gym_tracker.db` în spațiul de stocare al documentelor utilizatorului via `expo-file-system`, permițând salvarea în iCloud Drive sau Google Drive.

---

## 6. Rezumat Arhitectural & Principii de Calitate

1. **Integritate Tranzacțională:** Toate operațiunile care implică relații părinte-copil (Rutină + Exerciții, Sesiune + Seturi) se execută obligatoriu în tranzacții SQLite (`BEGIN TRANSACTION ... COMMIT`).
2. **Prioritate Absolută UI-ului (<16ms):** Bifa de set și feedback-ul haptic se produc sincron pe thread-ul UI prin Zustand, iar scrierea pe disc este realizată asincron în fundal.
3. **Reziliență la Stingerea Ecranului:** Niciun timer nu se bazează pe intervale incrementale în memorie; toate calculele de timp se bazează pe milisecunde absolute (`targetEndTime`).
4. **Independență Totală de Cloud:** Aplicația este 100% funcțională fără conexiune la internet, oferind o experiență de clasă mondială în orice sală de forță din lume.
