# 🛠️ VLVD Trend - PowerShell 헬퍼 스크립트

메모장 + PowerShell 환경에서 트렌드 모듈을 도입하기 위한 자동화 스크립트 6개.

## 📦 파일 구성

| 파일 | 역할 |
|---|---|
| `setup-vlvd-trend.ps1` | 원클릭 셋업 (zip 풀기 + 파일 복사 + npm install + git 브랜치) |
| `setup-env.ps1` | 환경변수 + .env.local 일괄 설정 (대화식) |
| `copy-migration.ps1` | Supabase SQL 파일을 클립보드에 복사 |
| `run-pipeline.ps1` | 크롤러 + AI 분석 한 번에 실행 |
| `toggle-mock.ps1` | 더미 ↔ 실 데이터 모드 전환 |
| `check-status.ps1` | 진행 상태 자가진단 |

## 🚀 사용 순서

### STEP 1: 모든 헬퍼 스크립트를 vlvd-dashboard 폴더 루트에 복사
```powershell
cd C:\dev\vlvd-dashboard       # 본인 경로
# 헬퍼 zip 풀어서 *.ps1 6개를 여기 두기
```

### STEP 2: 원클릭 셋업
```powershell
# 다운로드 폴더에 vlvd_trend_module.zip, vlvd_trend_v2_patch.zip 두 개 있어야 함
.\setup-vlvd-trend.ps1
```
이 한 줄로:
- feature/trend-module 브랜치 생성
- zip 2개 풀기 (v1 + v2)
- 파일 14+7개 복사
- npm install
- .gitignore 보강
- 검증 (필수 파일 누락 시 에러)

### STEP 3: App.jsx 라우트 수동 추가 (메모장)
```powershell
notepad .\src\App.jsx
```
두 줄 추가:
```jsx
import TrendDashboard from './pages/TrendDashboard'
// 그리고 Routes 안에
<Route path="/trend" element={<TrendDashboard />} />
```

### STEP 4: 더미 UI 확인
```powershell
npm run dev
# 브라우저: http://localhost:5173/trend
# Ctrl+C 로 중단
```
✅ **첫 번째 마일스톤** — UI 가 뜨면 절반 성공.

### STEP 5: 환경변수 + .env.local 설정
```powershell
.\setup-env.ps1
# 대화식으로 4개 키 입력:
# - Supabase Project URL
# - anon public key
# - service_role key
# - Anthropic API key
```

### STEP 6: Supabase 마이그레이션
```powershell
.\copy-migration.ps1 -Step 1
# → 클립보드에 복사됨. Supabase SQL Editor 에 붙여넣고 Run

.\copy-migration.ps1 -Step 2
# → Run

.\copy-migration.ps1 -Step 3
# → Run
```

### STEP 7: 크롤러 + AI 분석 로컬 테스트
```powershell
.\run-pipeline.ps1
# venv 자동 생성 → 의존성 설치 → 크롤러 → AI 분석
```

크롤러가 `parsed 0 items` 뜨면 무신사 셀렉터 보정 필요 → Claude 에 보고.

### STEP 8: 실 데이터 모드로 전환
```powershell
.\toggle-mock.ps1 -Mode real
# 다시 npm run dev → /trend 에서 실 데이터 확인
```
✅ **두 번째 마일스톤**

### STEP 9: GitHub 푸시 + Actions 활성화
```powershell
git add .
git commit -m "feat: VLVD trend module"
git push origin feature/trend-module
```
GitHub 웹에서 PR → main 머지 + Secrets 3개 등록 + Actions Run workflow.
✅ **세 번째 마일스톤** (완전 자동화)

## 🔍 상태 확인 (언제든)
```powershell
.\check-status.ps1
```
어디까지 됐는지 ✓/✗ 로 보여줍니다.

## 💡 자주 쓰는 명령 모음

```powershell
# 더미로 빠르게 전환
.\toggle-mock.ps1 -Mode mock

# 크롤링만 다시 (분석 건너뛰기)
.\run-pipeline.ps1 -SkipAnalyze

# 분석만 다시
.\run-pipeline.ps1 -SkipCrawl

# 현재 상태 점검
.\check-status.ps1
```

## ⚠️ 막힐 때

1. **PowerShell 스크립트 실행 차단**
   ```powershell
   Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
   ```

2. **크롤러 `parsed 0 items`** — 무신사 페이지 구조 변경. 셀렉터 보정 필요 → 에러 전체 복사해서 알려주세요.

3. **npm run dev 에서 import 에러** — App.jsx 라우트 경로 확인.

4. **Supabase 401** — `.env.local` 의 anon key 확인 + dev 서버 재시작.

5. **Anthropic 401** — API 키 형식 (`sk-ant-` 시작) 확인.
