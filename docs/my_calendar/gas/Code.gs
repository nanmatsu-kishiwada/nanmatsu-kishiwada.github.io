/**
 * 並松町若頭 オリジナルカレンダー作成アプリ - Googleドライブ保存用 Apps Script Web アプリ（参考実装）
 *
 * 【デプロイ手順（TODO）】
 * 1. https://script.google.com で新規プロジェクトを作成し、このファイルの内容を貼り付ける
 * 2. UPLOAD_SECRET と DRIVE_PARENT_FOLDER_ID を実際の値に置き換える
 *    - UPLOAD_SECRET: 任意の推測されにくい文字列（なりすまし投稿防止用）。
 *      docs/my_calendar/app.js の CONFIG.GAS_UPLOAD_SECRET と同じ値にすること
 *    - DRIVE_PARENT_FOLDER_ID: アップロード先にしたいGoogleドライブのフォルダID
 *      （フォルダをブラウザで開いたときのURL末尾の文字列）
 * 3. 「デプロイ」>「新しいデプロイ」>種類「ウェブアプリ」を選択
 *    - 実行するユーザー: 自分（このアカウントのDriveにファイルが保存される）
 *    - アクセスできるユーザー: 全員
 * 4. 発行されたウェブアプリURLを docs/my_calendar/app.js の CONFIG.GAS_WEB_APP_URL に設定する
 * 5. スクリプトの内容を変更した場合は「新しいデプロイ」ではなく既存デプロイの「編集」からバージョンを更新すること
 *    （URLを変えずに更新するため）
 */

// TODO: app.js の CONFIG.GAS_UPLOAD_SECRET と同じ値に置き換える
const UPLOAD_SECRET = 'TODO_GAS_UPLOAD_SECRET';

// TODO: アップロード先のGoogleドライブ親フォルダIDに置き換える
const DRIVE_PARENT_FOLDER_ID = 'TODO_DRIVE_PARENT_FOLDER_ID';

function doPost(e) {
    try {
        const request = JSON.parse(e.postData.contents);

        if (request.secret !== UPLOAD_SECRET) {
            return jsonResponse({ ok: false, error: 'invalid secret' });
        }
        if (!request.folderName || !Array.isArray(request.files) || request.files.length === 0) {
            return jsonResponse({ ok: false, error: 'invalid payload' });
        }

        const parentFolder = DriveApp.getFolderById(DRIVE_PARENT_FOLDER_ID);
        const userFolder = findOrCreateFolder(parentFolder, request.folderName);

        const savedFiles = request.files.map((fileInfo) => {
            const blob = Utilities.newBlob(
                Utilities.base64Decode(fileInfo.base64),
                fileInfo.mimeType,
                fileInfo.name
            );
            const file = userFolder.createFile(blob);
            // LINEのsendMessagesで読み込めるよう、リンクを知っている全員が閲覧可能にする
            file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
            return {
                name: fileInfo.name,
                url: 'https://drive.google.com/uc?export=view&id=' + file.getId()
            };
        });

        return jsonResponse({ ok: true, files: savedFiles });
    } catch (err) {
        return jsonResponse({ ok: false, error: String(err) });
    }
}

function findOrCreateFolder(parentFolder, folderName) {
    const existing = parentFolder.getFoldersByName(folderName);
    if (existing.hasNext()) {
        return existing.next();
    }
    return parentFolder.createFolder(folderName);
}

function jsonResponse(obj) {
    return ContentService.createTextOutput(JSON.stringify(obj))
        .setMimeType(ContentService.MimeType.JSON);
}
