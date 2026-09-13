// 並松町若頭 オリジナルカレンダー作成アプリ

// 設定定数
const CONFIG = {
    // LINE Developers コンソールで発行したLIFF IDを設定する
    LIFF_ID: '2011572489-lAikMEWi',
    // TODO: Google Apps Script を Web アプリとしてデプロイした後のURLを設定する（gas/Code.gs 参照）
    // GAS_WEB_APP_URL: 'https://script.google.com/macros/s/AKfycbwrElh1IYAo0cvdYa2rPFWlXo0nCHxu33KS8-pN5pYGo-R3wcEbrBIjqyytSgxRdxyX4A/exec',
    GAS_WEB_APP_URL: 'https://script.google.com/macros/s/AKfycbwftINy73lomiriH-6hjBvR7318hQ-kj4-feRQkKcJW/dev',
    // TODO: gas/Code.gs 側の UPLOAD_SECRET と同じ値を設定する（なりすまし投稿防止用の共有シークレット）
    GAS_UPLOAD_SECRET: 'NanmatsuWakagashira2026',
    // 最終合成画像の出力幅（A3・300dpi相当）。高さは各枠の縦横比から自動算出する
    EXPORT_WIDTH: 4961,
    // 確認画面プレビューの生成幅
    PREVIEW_WIDTH: 1600,
    // 利用可能なカレンダー枠
    // NOTE: frame01.png は低解像度の暫定サンプル。本番の高解像度・写真窓が透過抜きされた画像に差し替える際は
    //       width/height と cutout（写真をはめ込む窓の座標・サイズ）を実測して更新すること
    FRAMES: [
        {
            id: 'frame01',
            name: '枠デザインA',
            src: 'images/frames/frame01.png',
            width: 960,
            height: 671,
            cutout: { x: 233, y: 35, width: 494, height: 595, radius: 20 }
        },
        {
            id: 'frame02',
            name: '枠デザインB（暫定・frame01と同一画像）',
            src: 'images/frames/frame02.png',
            width: 960,
            height: 671,
            cutout: { x: 233, y: 35, width: 494, height: 595, radius: 20 }
        },
        {
            id: 'frame03',
            name: '枠デザインC（暫定・frame01と同一画像）',
            src: 'images/frames/frame03.png',
            width: 960,
            height: 671,
            cutout: { x: 233, y: 35, width: 494, height: 595, radius: 20 }
        }
    ]
};

// 画像読み込みをPromise化
function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) {
                resolve(blob);
            } else {
                reject(new Error('canvas.toBlob failed'));
            }
        }, type, quality);
    });
}

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            // data:xxx;base64, の prefix を除去
            const result = reader.result;
            const base64 = result.substring(result.indexOf(',') + 1);
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

function roundedRectPath(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
}

// LINEアカウント名等からGoogleドライブのフォルダ名に使えない文字を除去
function sanitizeForFolderName(text) {
    return String(text || '').replace(/[\\/:*?"<>|]/g, '').trim() || 'unknown';
}

const { createApp } = Vue;

const app = createApp({
    data() {
        return {
            currentScreen: 'edit', // edit | frameSelect | confirm | complete
            frames: CONFIG.FRAMES,
            selectedFrameIndex: 0,
            photoUrl: null,
            transform: { offsetX: 0, offsetY: 0, scale: 1, rotate: 0, baseWidth: 0, baseHeight: 0 },
            fitScale: 1,
            previewCompositeUrl: null,
            confirmZoom: 1,
            processing: false,
            processingMessage: '',
            liffProfile: null,
            liffInClient: false,
            photoInteractable: null,
            confirmInteractable: null
        };
    },
    computed: {
        currentFrame() {
            return this.frames[this.selectedFrameIndex];
        },
        screenTitle() {
            switch (this.currentScreen) {
                case 'frameSelect': return '枠を選択';
                case 'confirm': return '仕上がり確認';
                case 'complete': return '完了';
                default: return '並松町若頭 オリジナルカレンダー';
            }
        },
        frameStageStyle() {
            const frame = this.currentFrame;
            return {
                width: frame.width + 'px',
                height: frame.height + 'px',
                transform: 'scale(' + this.fitScale + ')'
            };
        },
        cutoutStyle() {
            const cutout = this.currentFrame.cutout;
            return {
                left: cutout.x + 'px',
                top: cutout.y + 'px',
                width: cutout.width + 'px',
                height: cutout.height + 'px',
                borderRadius: cutout.radius + 'px'
            };
        },
        photoTransformStyle() {
            const t = this.transform;
            return {
                width: t.baseWidth + 'px',
                height: t.baseHeight + 'px',
                marginLeft: (-t.baseWidth / 2) + 'px',
                marginTop: (-t.baseHeight / 2) + 'px',
                transform: 'translate(' + t.offsetX + 'px, ' + t.offsetY + 'px) rotate(' + t.rotate + 'deg) scale(' + t.scale + ')'
            };
        },
        confirmZoomStyle() {
            return {
                transform: 'scale(' + this.confirmZoom + ')'
            };
        }
    },
    mounted() {
        this.initLiff();
        window.addEventListener('resize', this.updateFitScale);
        this.$nextTick(() => this.updateFitScale());

        // ブラウザ標準のピンチズーム（画面全体の拡大）を無効化し、写真だけをズームできるようにする
        document.addEventListener('gesturestart', this.preventNativeGesture, { passive: false });
        document.addEventListener('gesturechange', this.preventNativeGesture, { passive: false });
        document.addEventListener('touchmove', this.preventMultiTouchScroll, { passive: false });
    },
    beforeUnmount() {
        window.removeEventListener('resize', this.updateFitScale);
        document.removeEventListener('gesturestart', this.preventNativeGesture);
        document.removeEventListener('gesturechange', this.preventNativeGesture);
        document.removeEventListener('touchmove', this.preventMultiTouchScroll);
        this.teardownPhotoGestures();
        this.teardownConfirmGestures();
    },
    methods: {
        async initLiff() {
            try {
                await liff.init({ liffId: CONFIG.LIFF_ID });
                this.liffInClient = liff.isInClient();
                if (!liff.isLoggedIn()) {
                    liff.login();
                    return;
                }
                this.liffProfile = await liff.getProfile();
            } catch (err) {
                // LIFF_ID未設定時など、開発中はここに来る想定
                console.error('LIFF init failed', err);
            }
        },

        updateFitScale() {
            const wrapper = this.$refs.frameStageWrapper;
            if (!wrapper) return;
            const availableWidth = wrapper.clientWidth;
            if (availableWidth > 0) {
                this.fitScale = availableWidth / this.currentFrame.width;
            }
        },

        triggerFileInput() {
            this.$refs.fileInput.click();
        },

        async onPhotoSelected(event) {
            const file = event.target.files && event.target.files[0];
            if (!file) return;

            const objectUrl = URL.createObjectURL(file);
            const img = await loadImage(objectUrl);

            this.photoUrl = objectUrl;
            this.resetTransformForCurrentCutout(img.naturalWidth, img.naturalHeight);

            await this.$nextTick();
            this.setupPhotoGestures();
        },

        // object-fit: cover 相当の初期サイズを算出し、位置・拡大率・回転をリセットする
        resetTransformForCurrentCutout(naturalWidth, naturalHeight) {
            const cutout = this.currentFrame.cutout;
            const imgRatio = naturalWidth / naturalHeight;
            const cutoutRatio = cutout.width / cutout.height;
            let baseWidth, baseHeight;
            if (imgRatio > cutoutRatio) {
                baseHeight = cutout.height;
                baseWidth = cutout.height * imgRatio;
            } else {
                baseWidth = cutout.width;
                baseHeight = cutout.width / imgRatio;
            }
            this.transform = {
                offsetX: 0,
                offsetY: 0,
                scale: 1,
                rotate: 0,
                baseWidth,
                baseHeight
            };
        },

        setupPhotoGestures() {
            this.teardownPhotoGestures();
            // img要素ではなくカットアウト全体(photo-layer)を対象にすることで、
            // ズームで写真が枠の外に出ている場合でも指を認識できるようにする
            const layer = this.$refs.photoLayer;
            if (!layer || typeof interact === 'undefined') return;

            this.photoInteractable = interact(layer)
                .draggable({
                    listeners: {
                        move: (event) => {
                            this.transform.offsetX += event.dx / this.fitScale;
                            this.transform.offsetY += event.dy / this.fitScale;
                        }
                    }
                })
                .gesturable({
                    listeners: {
                        move: (event) => {
                            this.transform.scale = Math.min(5, Math.max(0.2, this.transform.scale * (1 + event.ds)));
                            this.transform.rotate += event.da;
                        }
                    }
                });
        },

        teardownPhotoGestures() {
            if (this.photoInteractable) {
                this.photoInteractable.unset();
                this.photoInteractable = null;
            }
        },

        // ピンチ操作が難しい場合の代替手段としてのボタン操作
        adjustZoom(delta) {
            this.transform.scale = Math.min(5, Math.max(0.2, this.transform.scale + delta));
        },

        adjustRotate(deltaDeg) {
            this.transform.rotate += deltaDeg;
        },

        resetPhotoTransform() {
            this.transform.offsetX = 0;
            this.transform.offsetY = 0;
            this.transform.scale = 1;
            this.transform.rotate = 0;
        },

        preventNativeGesture(event) {
            event.preventDefault();
        },

        preventMultiTouchScroll(event) {
            if (event.touches && event.touches.length > 1) {
                event.preventDefault();
            }
        },

        setupConfirmGestures() {
            this.teardownConfirmGestures();
            const img = this.$refs.confirmPreviewImg;
            if (!img || typeof interact === 'undefined') return;

            // 確認画面は閲覧用のズームのみ（位置調整は編集画面で行う）
            this.confirmInteractable = interact(img).gesturable({
                listeners: {
                    move: (event) => {
                        this.confirmZoom = Math.min(4, Math.max(1, this.confirmZoom * (1 + event.ds)));
                    }
                }
            });
        },

        teardownConfirmGestures() {
            if (this.confirmInteractable) {
                this.confirmInteractable.unset();
                this.confirmInteractable = null;
            }
        },

        goToFrameSelect() {
            this.currentScreen = 'frameSelect';
        },

        async selectFrame(idx) {
            this.selectedFrameIndex = idx;
            if (this.photoUrl) {
                const img = await loadImage(this.photoUrl);
                this.resetTransformForCurrentCutout(img.naturalWidth, img.naturalHeight);
            }
            this.currentScreen = 'edit';
            await this.$nextTick();
            this.updateFitScale();
            this.setupPhotoGestures();
        },

        backToEdit() {
            this.teardownConfirmGestures();
            this.currentScreen = 'edit';
        },

        async goToConfirm() {
            if (!this.photoUrl) return;
            this.processing = true;
            this.processingMessage = 'プレビューを作成しています...';
            try {
                const canvas = await this.renderComposite(CONFIG.PREVIEW_WIDTH);
                this.previewCompositeUrl = canvas.toDataURL('image/jpeg', 0.9);
                this.confirmZoom = 1;
                this.currentScreen = 'confirm';
                await this.$nextTick();
                this.setupConfirmGestures();
            } catch (err) {
                console.error('プレビュー生成に失敗しました', err);
                alert('プレビューの作成に失敗しました。もう一度お試しください。');
            } finally {
                this.processing = false;
            }
        },

        // 枠画像と写真を合成したキャンバスを生成する（confirmプレビュー・最終出力の両方で使用）
        async renderComposite(targetWidth) {
            const frame = this.currentFrame;
            const scaleRatio = targetWidth / frame.width;
            const targetHeight = Math.round(frame.height * scaleRatio);

            const canvas = document.createElement('canvas');
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            const ctx = canvas.getContext('2d');

            const photoImg = await loadImage(this.photoUrl);
            this.drawClippedPhoto(ctx, photoImg, scaleRatio);

            const frameImg = await loadImage(frame.src);
            ctx.drawImage(frameImg, 0, 0, targetWidth, targetHeight);

            return canvas;
        },

        // 枠で切り抜いた写真のみのキャンバスを生成する（Driveへ保存する素材用）
        async renderCroppedPhoto(targetCutoutWidth) {
            const cutout = this.currentFrame.cutout;
            const scaleRatio = targetCutoutWidth / cutout.width;
            const targetCutoutHeight = Math.round(cutout.height * scaleRatio);

            const canvas = document.createElement('canvas');
            canvas.width = targetCutoutWidth;
            canvas.height = targetCutoutHeight;
            const ctx = canvas.getContext('2d');

            const photoImg = await loadImage(this.photoUrl);
            // カットアウト原点を(0,0)とみなして描画する
            const shiftedCutout = { x: 0, y: 0, width: cutout.width, height: cutout.height, radius: cutout.radius };
            this.drawClippedPhotoInto(ctx, photoImg, scaleRatio, shiftedCutout);

            return canvas;
        },

        drawClippedPhoto(ctx, photoImg, scaleRatio) {
            this.drawClippedPhotoInto(ctx, photoImg, scaleRatio, this.currentFrame.cutout);
        },

        drawClippedPhotoInto(ctx, photoImg, scaleRatio, cutout) {
            const t = this.transform;
            const cutoutX = cutout.x * scaleRatio;
            const cutoutY = cutout.y * scaleRatio;
            const cutoutW = cutout.width * scaleRatio;
            const cutoutH = cutout.height * scaleRatio;
            const radius = cutout.radius * scaleRatio;
            const centerX = cutoutX + cutoutW / 2;
            const centerY = cutoutY + cutoutH / 2;

            ctx.save();
            roundedRectPath(ctx, cutoutX, cutoutY, cutoutW, cutoutH, radius);
            ctx.clip();

            ctx.translate(centerX + t.offsetX * scaleRatio, centerY + t.offsetY * scaleRatio);
            ctx.rotate(t.rotate * Math.PI / 180);
            ctx.scale(t.scale, t.scale);
            ctx.drawImage(photoImg, -(t.baseWidth * scaleRatio) / 2, -(t.baseHeight * scaleRatio) / 2, t.baseWidth * scaleRatio, t.baseHeight * scaleRatio);
            ctx.restore();
        },

        buildFolderName() {
            const displayName = this.liffProfile ? this.liffProfile.displayName : 'ゲスト';
            const userId = this.liffProfile ? this.liffProfile.userId : 'unknown';
            const suffix = userId.slice(-6);
            return sanitizeForFolderName(displayName) + '_' + suffix;
        },

        async onOrderTapped() {
            const confirmed = window.confirm('この内容で注文します。よろしいですか？');
            if (!confirmed) return;

            this.processing = true;
            this.processingMessage = '送信しています...';
            try {
                const timestamp = Date.now();
                const compositeCanvas = await this.renderComposite(CONFIG.EXPORT_WIDTH);
                const cutout = this.currentFrame.cutout;
                const cropWidth = Math.round(CONFIG.EXPORT_WIDTH * (cutout.width / this.currentFrame.width));
                const croppedCanvas = await this.renderCroppedPhoto(cropWidth);

                const compositeBlob = await canvasToBlob(compositeCanvas, 'image/jpeg', 0.92);
                const croppedBlob = await canvasToBlob(croppedCanvas, 'image/png');

                const payload = {
                    secret: CONFIG.GAS_UPLOAD_SECRET,
                    folderName: this.buildFolderName(),
                    files: [
                        {
                            name: 'composite_' + timestamp + '.jpg',
                            mimeType: 'image/jpeg',
                            base64: await blobToBase64(compositeBlob)
                        },
                        {
                            name: 'photo_' + timestamp + '.png',
                            mimeType: 'image/png',
                            base64: await blobToBase64(croppedBlob)
                        }
                    ]
                };

                const response = await this.uploadToDrive(payload);
                const compositeFile = response.files && response.files.find((f) => f.name.indexOf('composite_') === 0);
                if (compositeFile && compositeFile.url) {
                    await this.sendLineRecord(compositeFile.url);
                }

                this.currentScreen = 'complete';
            } catch (err) {
                console.error('注文処理に失敗しました', err);
                alert('送信に失敗しました。通信状態を確認してもう一度お試しください。');
            } finally {
                this.processing = false;
            }
        },

        async uploadToDrive(payload) {
            // Content-Type を指定しない（= text/plain）ことで、Apps Script非対応のCORSプリフライトを回避する
            const response = await fetch(CONFIG.GAS_WEB_APP_URL, {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            if (!response.ok) {
                throw new Error('Driveへのアップロードに失敗しました: HTTP ' + response.status);
            }
            const json = await response.json();
            if (!json.ok) {
                throw new Error('Driveへのアップロードに失敗しました: ' + (json.error || 'unknown error'));
            }
            return json;
        },

        // 完了画像をLINEトーク上に記録として送信する（Messaging APIは使用しない）
        async sendLineRecord(imageUrl) {
            if (!this.liffInClient) return;
            try {
                await liff.sendMessages([
                    { type: 'image', originalContentUrl: imageUrl, previewImageUrl: imageUrl }
                ]);
            } catch (err) {
                // 送信に失敗してもDriveへの保存は完了しているため、エラーはログのみ
                console.error('liff.sendMessages failed', err);
            }
        },

        onCloseTapped() {
            if (this.liffInClient) {
                liff.closeWindow();
            } else {
                this.currentScreen = 'edit';
                this.photoUrl = null;
            }
        }
    }
});

app.config.compilerOptions.isCustomElement = (tag) => tag.includes('-');
app.mount('#app');
