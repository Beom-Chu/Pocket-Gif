# Pocket GIF

휴대폰 브라우저에서 동영상을 기기 밖으로 업로드하지 않고, 3초 단위 GIF로 변환하는 정적 React/Vite 웹앱입니다. 여러 영상을 한 번에 선택할 수 있고, 긴 영상은 3초 구간별 썸네일을 확인한 뒤 원하는 구간만 개별 또는 일괄 저장할 수 있습니다.

## 주요 기능

- 브라우저 내부에서 영상 프레임 추출 및 GIF 인코딩
- 최대 20개 영상 선택
- 영상 길이에 따라 3초 구간 자동 분할
- 구간별 썸네일과 선택적 변환
- 표준/고화질 출력 설정
- 개별 GIF 다운로드 및 일괄 저장
- Android Chrome에서는 공유 패널 대신 직접 다운로드
- PWA 매니페스트와 서비스 워커 포함
- 지선이를 위한 헌정 문구 포함

## 로컬 실행

Node.js 20 이상과 pnpm을 권장합니다.

```bash
pnpm install
pnpm dev
```

브라우저에서 `http://localhost:3000`을 엽니다.

## 검사 및 빌드

```bash
pnpm check
pnpm build:vercel
pnpm preview
```

Vercel 배포용 빌드 결과는 `dist/public`에 생성됩니다. GIF 변환은 서버가 아니라 사용자의 브라우저에서 실행되므로 서버 API나 환경변수 설정이 필요하지 않습니다.

## GitHub에 올리기

1. GitHub에서 새 저장소를 만듭니다. 예: `pocket-gif`
2. 이 ZIP을 압축 해제합니다.
3. 압축 해제한 폴더에서 다음 명령을 실행합니다.

```bash
git init
git add .
git commit -m "Initial Pocket GIF app"
git branch -M main
git remote add origin https://github.com/YOUR_ACCOUNT/YOUR_REPOSITORY.git
git push -u origin main
```

`YOUR_ACCOUNT`와 `YOUR_REPOSITORY`는 본인의 GitHub 계정과 저장소 이름으로 바꿉니다.

## Vercel에 배포하기

1. [Vercel](https://vercel.com)에 로그인합니다.
2. **Add New → Project → Import Git Repository**를 선택합니다.
3. 방금 GitHub에 올린 저장소를 선택합니다.
4. 별도 설정을 바꾸지 않고 Deploy를 누릅니다. 저장소의 `vercel.json`이 다음 값을 자동으로 사용합니다.

| 항목 | 값 |
| --- | --- |
| Framework | Vite |
| Install Command | `pnpm install --frozen-lockfile` |
| Build Command | `pnpm build:vercel` |
| Output Directory | `dist/public` |

커스텀 도메인을 연결하려면 Vercel 프로젝트의 **Settings → Domains**에서 도메인을 추가하고, 안내된 DNS 레코드를 도메인 등록 업체에 입력합니다.

## 개인정보 및 처리 방식

선택한 영상은 GIF 변환을 위해 현재 브라우저 메모리에서만 읽습니다. 이 프로젝트에는 영상 업로드 API가 없습니다. 브라우저 저장 공간에 남는 원본 파일을 별도로 저장하지 않으며, 결과 GIF는 사용자가 다운로드할 때까지 현재 페이지에서만 유지됩니다.

## 제한 사항

브라우저 기반 변환은 기기의 메모리와 배터리를 사용합니다. 파일당 500MB, 한 번에 최대 20개 영상으로 제한되어 있으며, 모바일에서는 고화질보다 표준 품질이 안정적입니다.

## 라이선스

MIT
